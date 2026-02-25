import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { listProjects, listSessions } from "./session-discovery.js";
import {
  spawnChatAgent,
  listChatAgents,
  killChatAgent,
  subscribeChatAgent,
  unsubscribeChatAgent,
  sendMessage,
  getChatAgent,
} from "./chat-agent.js";
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
    res.end(JSON.stringify(listChatAgents()));
    return;
  }

  if (req.url === "/api/agents" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body) as {
          projectPath: string;
          resumeSessionId?: string;
        };
        const agent = spawnChatAgent(payload.projectPath, payload.resumeSessionId);
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
    killChatAgent(id);
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
  if (req.url?.startsWith("/ws/chat/")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req: IncomingMessage) => {
  const urlPath = req.url ?? "";

  // Chat WebSocket: /ws/chat/{agentId}
  if (urlPath.startsWith("/ws/chat/")) {
    const agentId = urlPath.slice(9);
    subscribeChatAgent(agentId, ws);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ChatWsClientMessage;
        if (msg.type === "user_input") {
          sendMessage(agentId, msg.text);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      unsubscribeChatAgent(agentId, ws);
    });
    return;
  }
});

server.listen(7777, "0.0.0.0", () => {
  console.log("aiMessage V3 (Headless) listening on http://0.0.0.0:7777");
});
