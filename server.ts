import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import pty from "node-pty";

const html = readFileSync(new URL("./index.html", import.meta.url));

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let ptyProcess: ReturnType<typeof pty.spawn> | null = null;

  try {
    ptyProcess = pty.spawn("tmux", ["new-session", "-A", "-s", "main"], {
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
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
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
      // not JSON, fall through
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
