import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import { listProjects, listSessions } from "./session-discovery.js";
import { spawnAgent, listAgents, killAgent } from "./agent-manager.js";

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

const server = createServer((req, res) => {
  if (req.url === "/api/projects" && req.method === "GET") {
    const projects = listProjects();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(projects));
    return;
  }

  if (req.url?.match(/^\/api\/projects\/([^/]+)\/sessions$/) && req.method === "GET") {
    const key = req.url.match(/^\/api\/projects\/([^/]+)\/sessions$/)![1];
    const sessions = listSessions(decodeURIComponent(key));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sessions));
    return;
  }

  if (req.url === "/api/agents" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listAgents()));
    return;
  }

  if (req.url === "/api/agents" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { projectPath, resumeSessionId } = JSON.parse(body) as { projectPath: string; resumeSessionId?: string };
        const agent = spawnAgent(projectPath, resumeSessionId);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(agent));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.url?.match(/^\/api\/agents\/([^/]+)$/) && req.method === "DELETE") {
    const id = req.url.match(/^\/api\/agents\/([^/]+)$/)![1];
    killAgent(id);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET") { res.writeHead(404); res.end(); return; }

  const urlPath = req.url === "/" ? "/index.html" : (req.url?.split("?")[0] ?? "/index.html");
  const filePath = join(DIST, urlPath);

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    try {
      const content = readFileSync(join(DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found — run npm run build first");
    }
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  if (req.url?.startsWith("/ws/")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req: IncomingMessage) => {
  const segment = req.url?.slice(4) ?? "main";
  const tmuxSession = segment.length > 0 ? segment : "main";

  let ptyProcess: ReturnType<typeof pty.spawn> | null = null;

  try {
    ptyProcess = pty.spawn("tmux", ["new-session", "-A", "-s", tmuxSession], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME,
      env: { ...process.env },
    });
  } catch (err) {
    console.error("pty.spawn failed:", err);
    ws.send(`\r\nError: failed to start terminal session: ${err}\r\n`);
    ws.close();
    return;
  }

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  ptyProcess.onExit(() => {
    ws.close();
  });

  ws.on("message", (raw) => {
    if (!ptyProcess) return;
    const msg = raw.toString();
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        ptyProcess.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // not JSON, treat as terminal input
    }
    ptyProcess.write(msg);
  });

  ws.on("close", () => {
    if (ptyProcess) ptyProcess.kill();
  });
});

server.listen(7777, "0.0.0.0", () => {
  console.log("aiMessage V3 listening on http://0.0.0.0:7777");
});
