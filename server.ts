import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { readFileSync, writeFileSync, unlinkSync, existsSync, appendFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import * as os from "node:os";
import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import { WebSocketServer } from "ws";

// Real-time file logging
const logPath = join(fileURLToPath(new URL(".", import.meta.url)), "server.log");
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
  const msg = args.join(" ");
  // Don't log internal Tailscale noise to the file
  if (msg.includes("[Tailscale]") || msg.includes("https://maxs-macbook-pro.tail591d8a.ts.net")) {
    originalLog(...args);
    return;
  }
  appendFileSync(logPath, `[LOG] ${msg}\n`);
  originalLog(...args);
};
console.error = (...args) => {
  appendFileSync(logPath, `[ERR] ${args.join(" ")}\n`);
  originalError(...args);
};
console.warn = (...args) => {
  appendFileSync(logPath, `[WRN] ${args.join(" ")}\n`);
  originalWarn(...args);
};

import { listProjects, listSessions, renameProject, renameSession, createProjectFolder } from "./session-discovery.js";
import { TmuxSessionEngine } from "./src/engine-v2/TmuxSessionEngine.js";
let engine = new TmuxSessionEngine();

import type { ChatWsClientMessage } from "./shared/stream-types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(__dirname, "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  console.log(`[Request] ${req.method} ${req.url}`);

  if (req.url === "/api/transcribe" && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        const tmpInput = join(os.tmpdir(), `voice-${Date.now()}.webm`);
        const boundary = req.headers["content-type"]?.split("boundary=")[1];
        if (!boundary) throw new Error("No boundary");

        const bufferString = buffer.toString("binary");
        const parts = bufferString.split("--" + boundary);
        const audioPart = parts.find(p => p.includes("audio"));
        if (!audioPart) throw new Error("No audio part found");

        const dataStart = audioPart.indexOf("\r\n\r\n") + 4;
        const dataEnd = audioPart.lastIndexOf("\r\n");
        const audioData = Buffer.from(audioPart.slice(dataStart, dataEnd), "binary");

        writeFileSync(tmpInput, audioData);
        console.log(`[Transcribe] Processing ${tmpInput}...`);
        
        let text = "";
        try {
          const venvPython = join(os.homedir(), ".claude", "models", "venv", "bin", "python");
          const bridgeScript = join(os.homedir(), ".claude", "models", "transcribe.py");
          
          if (existsSync(bridgeScript)) {
            // Add a timeout to prevent hanging forever
            text = execSync(`"${venvPython}" "${bridgeScript}" "${tmpInput}"`, { 
              timeout: 60000,
              stdio: "pipe" 
            }).toString().trim();
            console.log(`[Transcribe] Success: "${text}"`);

            // DEBUG: Save for verification
            try {
              const debugDir = join(__dirname, "debug");
              const audioName = `voice-${Date.now()}.webm`;
              const audioDest = join(debugDir, "audio", audioName);
              const logFile = join(debugDir, "transcriptions.log");
              
              if (!existsSync(join(debugDir, "audio"))) {
                execSync(`mkdir -p "${join(debugDir, "audio")}"`);
              }

              writeFileSync(audioDest, readFileSync(tmpInput));
              appendFileSync(logFile, `[${new Date().toISOString()}] Audio: ${audioName} | Text: "${text}"\n`);
              console.log(`[Debug] Saved to ${audioDest} and log.`);
            } catch (debugErr) {
              console.error("[Debug] Failed to save transcription for testing:", debugErr);
            }

          } else {
            text = "(Voice setup required: run 'npm run setup:voice')";
            console.warn("[Transcribe] Bridge script missing.");
          }
        } catch (err: any) {
          console.error("[Transcribe] Local Parakeet failed:", err.message);
          text = "(Transcription error or timeout)";
        }

        unlinkSync(tmpInput);
        console.log(`[Transcribe] Sending response to client: "${text}"`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.url === "/api/projects" && req.method === "GET") {
    const projects = listProjects();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(projects));
    return;
  }

  if (req.url === "/api/projects" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { path: dirPath, name, model } = JSON.parse(body);
        if (!dirPath) throw new Error("Project path is required");

        const projectPath = createProjectFolder(dirPath, name);
        const displayName = name || basename(projectPath);
        const sessionModel = model || "sonnet";
        const sessionId = crypto.randomUUID();
        await engine.create(sessionId, projectPath, sessionModel);

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          projectPath,
          agent: {
            id: sessionId,
            type: "chat",
            title: displayName,
            projectPath,
            model: sessionModel,
            status: "running",
            agentStatus: "idle",
            unreadCount: 0,
            startedAt: new Date().toISOString()
          }
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.url?.match(/^\/api\/projects\/([^/]+)\/rename$/) && req.method === "POST") {
    const key = req.url.match(/^\/api\/projects\/([^/]+)\/rename$/)![1];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { alias } = JSON.parse(body);
        renameProject(decodeURIComponent(key), alias);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.url?.match(/^\/api\/sessions\/([^/]+)\/rename$/) && req.method === "POST") {
    const id = req.url.match(/^\/api\/sessions\/([^/]+)\/rename$/)![1];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { alias } = JSON.parse(body);
        renameSession(decodeURIComponent(id), alias);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.url?.match(/^\/api\/projects\/([^/]+)\/sessions$/) && req.method === "GET") {
    const key = req.url.match(/^\/api\/projects\/([^/]+)\/sessions$/)![1];
    const sessions = listSessions(decodeURIComponent(key));
    
    // Augment sessions with real engine status
    const augmentedSessions = await Promise.all(sessions.map(async (session) => {
      const state = await engine.getState(session.id);
      return {
        ...session,
        agentId: session.id,
        agentStatus: state?.status === 'busy' ? 'thinking' : 'idle',
        status: state?.status === 'sleeping' ? 'stopped' : 'running',
        hasUnread: state?.hasUnread || false,
        latestNotification: state?.latestNotification || null,
        unreadCount: 0 // Keep for backwards compat
      };
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(augmentedSessions));
    return;
  }

  if (req.url === "/api/agents" && req.method === "GET") {
    // List sessions that have active processes
    const activeIds = engine.listActiveSessions();
    const activeAgents = await Promise.all(activeIds.map(async (id) => {
      const state = await engine.getState(id);
      return {
        id,
        type: "chat",
        title: (state as any)?.title || "Chat",
        projectPath: state?.projectPath || "",
        model: state?.model,
        status: "running",
        agentStatus: state?.status === 'busy' ? 'thinking' : 'idle',
        hasUnread: state?.hasUnread || false,
        latestNotification: state?.latestNotification || null
      };
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(activeAgents));
    return;
  }

  if (req.url === "/api/agents" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body) as {
          projectPath: string;
          resumeSessionId?: string;
          model?: string;
        };
        
        const projectPath = payload.projectPath.replace(/^~/, os.homedir());
        const sessionId = payload.resumeSessionId || crypto.randomUUID();
        await engine.create(sessionId, projectPath, payload.model || "sonnet");

        const state = await engine.getState(sessionId);
        const title = (state as any)?.title || (payload.resumeSessionId ? "Chat" : "New Chat");

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: sessionId,
          type: "chat",
          title,
          projectPath,
          model: payload.model || "sonnet",
          status: "running",
          agentStatus: "idle",
          unreadCount: 0,
          startedAt: new Date().toISOString()
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.url?.match(/^\/api\/agents\/([^/]+)$/) && req.method === "DELETE") {
    const id = req.url.match(/^\/api\/agents\/([^/]+)$/)![1];
    try {
      await engine.interrupt(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ interrupted: id }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.url === "/api/test/restart-engine" && req.method === "POST") {
    try {
      console.log('[Test] Restarting engine...');
      engine.stop();
      engine = new TmuxSessionEngine();
      await engine.reconcile();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.url?.match(/^\/api\/test\/destroy-session\/([^/]+)$/) && req.method === "POST") {
    const id = req.url.match(/^\/api\/test\/destroy-session\/([^/]+)$/)![1];
    try {
      await engine.destroy(id, true);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.url === "/api/status" && req.method === "GET") {
    const status = engine.getSystemStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status));
    return;
  }

  if (req.url === "/api/emergency-stop" && req.method === "POST") {
    try {
      console.log('[Server] Emergency stop triggered');
      const killed = await engine.killAll();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ killed, count: killed.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.method !== "GET") { res.writeHead(404); res.end(); return; }

  if (req.url === "/debug-chat") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font:17px/1.4 -apple-system,sans-serif;padding:20px;max-width:600px;margin:0 auto}
#log{height:60vh;overflow-y:auto;background:#f5f5f5;border-radius:12px;padding:12px;margin-bottom:12px;font-size:14px}
.row{display:flex;gap:8px}input{flex:1;font-size:17px;padding:10px 16px;border-radius:22px;border:1px solid #ddd;outline:none}
button{padding:10px 20px;border-radius:22px;border:none;background:#007AFF;color:#fff;font-size:17px;cursor:pointer}</style></head>
<body><h3>Debug Chat</h3><div id="log"></div><div class="row"><input id="msg" placeholder="Type here..." enterkeyhint="send">
<button id="send">Send</button></div>
<script>
const log=document.getElementById('log'),input=document.getElementById('msg'),btn=document.getElementById('send');
function addLog(t,c){const d=document.createElement('div');d.textContent=t;d.style.color=c||'#333';log.appendChild(d);log.scrollTop=log.scrollHeight;}
const agents=fetch('/api/agents').then(r=>r.json());
agents.then(list=>{
  if(!list.length){addLog('No agents found','red');return;}
  const id=list[0].id;
  addLog('Connecting to agent: '+id+'...');
  const proto=location.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(proto+'//'+location.host+'/ws/chat/'+id);
  ws.onopen=()=>addLog('WS CONNECTED','green');
  ws.onclose=(e)=>addLog('WS CLOSED code='+e.code,'red');
  ws.onerror=(e)=>addLog('WS ERROR','red');
  ws.onmessage=(e)=>{
    try{const m=JSON.parse(e.data);
      if(m.type==='history_snapshot')addLog('Got history: '+m.items.length+' items','blue');
      else if(m.type==='stream_item')addLog((m.item.kind==='user_message'?'You: ':'Agent: ')+(m.item.text||m.item.kind),'#333');
      else addLog('Server: '+m.type,'gray');
    }catch(err){addLog('Parse error: '+err,'red');}
  };
  function send(){const t=input.value.trim();if(!t)return;if(ws.readyState!==1){addLog('WS not open (state='+ws.readyState+')','red');return;}
    ws.send(JSON.stringify({type:'user_input',text:t}));addLog('SENT: '+t,'green');input.value='';}
  btn.onclick=send;
  input.onkeydown=(e)=>{if(e.key==='Enter'){e.preventDefault();send();}};
});
</script></body></html>`);
    return;
  }

  const urlPath = req.url === "/" ? "/index.html" : (req.url?.split("?")[0] ?? "/index.html");
  const filePath = join(DIST, urlPath);

  try {
    const content = readFileSync(filePath);
    console.log(`[Serve] 200: ${filePath} (${MIME[extname(filePath)] ?? "application/octet-stream"})`);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    try {
      const content = readFileSync(join(DIST, "index.html"));
      console.log(`[Serve] 200 (SPA Fallback): index.html for ${req.url}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      console.error(`[Serve] 404: ${filePath}`);
      res.writeHead(404);
      res.end("Not found — run npm run build first");
    }
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  if (req.url?.startsWith("/ws/chat/")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req: IncomingMessage) => {
  const urlPath = req.url ?? "";

  // Chat WebSocket: /ws/chat/{sessionId}
  if (urlPath.startsWith("/ws/chat/")) {
    const sessionId = urlPath.slice(9);
    
    // 1. Start Observation (Tailing the Movie)
    engine.observe(sessionId, 0).then(stream => {
      const reader = stream.getReader();
      
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done || ws.readyState !== 1) break;
          ws.send(value);
        }
      };
      
      pump().catch(() => {});
    });

    // 2. Forward chat_title_update engine events to this WebSocket
    const titleHandler = ({ sessionId: sid, title }: { sessionId: string; title: string }) => {
      if (sid === sessionId && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "chat_title_update", title }) + "\n");
      }
    };
    engine.on("chat_title_update", titleHandler);

    // 3. Handle User Input (Queuing)
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ChatWsClientMessage;
        if (msg.type === "user_input") {
          if (msg.text.trim() === "/clear") {
            console.log(`[WS] /clear received for session ${sessionId} — interrupting Claude`);
            engine.interrupt(sessionId).catch((err: unknown) => {
              console.error(`[WS] interrupt failed:`, err);
            });
            ws.send(JSON.stringify({ type: "context_cleared" }));
            return;
          }
          if (msg.text.trim() === "/plan") {
            console.log(`[WS] /plan received for session ${sessionId} — substituting planning instruction`);
            const planningInstruction = "Enter planning mode. Think through the problem step by step and present a complete plan. Do not take any actions — no file edits, no shell commands, no tool use — until the user explicitly tells you to proceed. Present the plan clearly so it can be reviewed and approved.";
            engine.submit(sessionId, "ws-client", planningInstruction);
            ws.send(JSON.stringify({ type: "plan_mode_entered" }));
            return;
          }
          console.log(`[WS] Queuing user_input for session ${sessionId}: "${msg.text}"`);
          engine.submit(sessionId, "ws-client", msg.text);
        }
      } catch {
        // ignore malformed
      }
    });

    ws.on("close", () => {
      engine.off("chat_title_update", titleHandler);
      // Stream will close naturally via reader loop check
    });
    return;
  }
});

server.listen(7777, "0.0.0.0", () => {
  console.log("aiMessage V4 (tmux engine) listening on http://0.0.0.0:7777");

  // Reconnect to any tmux sessions that survived the previous server instance
  engine.reconcile().catch(err => {
    console.error("[Boot] Reconciliation failed:", err);
  });

  // Automatically ensure Tailscale HTTPS tunnel is active
  try {
    const tsPath = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (existsSync(tsPath)) {
      console.log("[Tailscale] Ensuring HTTPS tunnel is active...");
      const out = execSync(`"${tsPath}" serve --bg 7777`).toString();
      if (out.includes("https://")) {
        const url = out.match(/https:\/\/[^\s]+/)?.[0];
        if (url) console.log(`[Tailscale] External HTTPS URL: ${url}`);
      }
    }
  } catch (err) {
    console.log("[Tailscale] Tunnel auto-start skipped (might need manual login or already running)");
  }
});

// Graceful shutdown — close FIFOs but keep tmux sessions alive
process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  engine.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down...');
  engine.stop();
  process.exit(0);
});
