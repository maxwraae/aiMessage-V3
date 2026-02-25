import { spawn, ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import * as readline from "node:readline";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { WebSocket } from "ws";
import type { StreamItem, ChatWsServerMessage } from "./shared/stream-types.js";
import { isNoise, SMART_NAMING_PROMPT } from "./shared/filter-config.js";
import { executeOneShot } from "./lib/claude-one-shot.js";

export type ChatAgent = {
  id: string;
  type: "chat";
  title: string;
  projectPath: string;
  status: "running" | "stopped";
  agentStatus: "idle" | "thinking" | "done" | "error";
  unreadCount: number;
  startedAt: string;
};

type AgentEntry = {
  agent: ChatAgent;
  process: ChildProcess;
  history: StreamItem[];
  subscribers: Set<WebSocket>;
  sessionId?: string;
  isSmartNamed?: boolean;
};

const entries = new Map<string, AgentEntry>();

const CLAUDE_BINARY = "/Users/maxwraae/.local/bin/claude";

function emit(entry: AgentEntry, msg: ChatWsServerMessage) {
  // If it's a new stream item and we have no viewers, increment unread count
  if (msg.type === "stream_item" && entry.subscribers.size === 0) {
    // Only count meaningful things as unread (not thoughts)
    if (msg.item.kind !== "thought") {
      entry.agent.unreadCount++;
    }
  }

  const json = JSON.stringify(msg);
  for (const ws of entry.subscribers) {
    if (ws.readyState === 1 /* OPEN */) ws.send(json);
  }
}

async function triggerSmartNaming(entry: AgentEntry) {
  if (entry.isSmartNamed) return;
  
  const context = entry.history
    .filter(i => i.kind === "user_message" || i.kind === "assistant_message")
    .map(i => `${i.kind === "user_message" ? "User" : "Assistant"}: ${i.text}`)
    .join("\n\n");

  if (!context) return;

  console.log(`[One-Shot] Requesting smart name for agent ${entry.agent.id}...`);
  entry.isSmartNamed = true;

  try {
    const smartName = await executeOneShot({
      model: "haiku",
      systemPrompt: SMART_NAMING_PROMPT,
      prompt: `Conversation so far:\n${context}`,
      sterile: true
    });

    if (smartName && smartName.length < 50 && !isNoise(smartName)) {
      console.log(`[One-Shot] Smart name generated: "${smartName}"`);
      entry.agent.title = smartName.toLowerCase().replace(/[".]/g, "");
      emit(entry, { type: "chat_title_update", title: entry.agent.title });
    }
  } catch (err) {
    console.error(`[One-Shot] Smart naming failed for ${entry.agent.id}:`, err);
    entry.isSmartNamed = false;
  }
}

function parseClaudeEvent(line: string, entry: AgentEntry) {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    const sysItem: StreamItem = {
      kind: "system",
      text: line,
      id: crypto.randomBytes(3).toString("hex"),
      timestamp: new Date().toISOString(),
    };
    entry.history.push(sysItem);
    emit(entry, { type: "stream_item", item: sysItem });
    return;
  }

  const ts = new Date().toISOString();

  if (event.type === "system" && event.subtype === "init" && event.session_id) {
    entry.sessionId = event.session_id;
    return;
  }

  if (event.type === "assistant" && event.message?.content) {
    const contents = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
    for (const block of contents) {
      let item: StreamItem | null = null;

      if (block.type === "text" && block.text) {
        if (!isNoise(block.text)) {
          item = {
            kind: "assistant_message",
            text: block.text,
            id: crypto.randomBytes(3).toString("hex"),
            timestamp: ts,
          };
        }
      } else if (block.type === "thinking" && block.thinking) {
        item = {
          kind: "thought",
          text: block.thinking,
          id: crypto.randomBytes(3).toString("hex"),
          timestamp: ts,
          status: "ready",
        };
      } else if (block.type === "tool_use") {
        item = {
          kind: "tool_call",
          name: block.name,
          input: block.input,
          status: "running",
          id: block.id ?? crypto.randomBytes(3).toString("hex"),
          timestamp: ts,
        };
      }

      if (item) {
        entry.history.push(item);
        emit(entry, { type: "stream_item", item });
      }
    }
  } else if (event.type === "tool_result") {
    const toolId = event.tool_use_id;
    const existing = entry.history.find(
      (i) => i.kind === "tool_call" && i.id === toolId
    ) as Extract<StreamItem, { kind: "tool_call" }> | undefined;
    if (existing) {
      existing.status = event.is_error ? "failed" : "completed";
      existing.result = event.content;
      emit(entry, { type: "stream_item", item: existing });
    }
  } else if (event.type === "result" && event.subtype === "success") {
    entry.agent.agentStatus = "idle";
    emit(entry, { type: "agent_status", status: "idle" });
    
    if (!entry.isSmartNamed && entry.history.length >= 2) {
      triggerSmartNaming(entry);
    }
  }
}

function extractTitleFromHistory(projectPath: string, sessionId: string): string | null {
  const projectSlug = projectPath.replace(/\//g, "-");
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  
  let projectDir: string | null = null;
  try {
    const dirs = fs.readdirSync(projectsDir);
    projectDir = dirs.find(d => d === projectSlug || d === `-${projectSlug}` || d.includes(projectSlug)) || null;
  } catch { return null; }

  if (!projectDir) return null;
  const filePath = path.join(projectsDir, projectDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, any>;
        if (obj.type === "user" && obj.message) {
          const content = obj.message.content;
          let text = "";
          if (typeof content === "string") text = content;
          else if (Array.isArray(content)) text = content.map((b: any) => b.text ?? "").join("").trim();
          
          if (text && !isNoise(text)) {
            return text.slice(0, 60) + (text.length > 60 ? "…" : "");
          }
        }
      } catch { continue; }
    }
  } catch { return null; }
  return null;
}

function loadSessionHistory(projectPath: string, sessionId: string): StreamItem[] {
  const projectSlug = projectPath.replace(/\//g, "-");
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  
  let projectDir: string | null = null;
  try {
    const dirs = fs.readdirSync(projectsDir);
    projectDir = dirs.find(d => d === projectSlug || d === `-${projectSlug}` || d.includes(projectSlug)) || null;
  } catch (err) {
    return [];
  }

  if (!projectDir) return [];

  const filePath = path.join(projectsDir, projectDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  const items: StreamItem[] = [];
  const ts = new Date().toISOString();
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as any;
        if (entry.isSidechain) continue;

        if (entry.type === "user" && entry.message?.content) {
          const content = typeof entry.message.content === "string"
            ? entry.message.content
            : Array.isArray(entry.message.content)
              ? entry.message.content.map((b: any) => b.text || "").join("")
              : "";
          
          if (content.trim() && !isNoise(content)) {
            items.push({ kind: "user_message", text: content, id: crypto.randomBytes(3).toString("hex"), timestamp: ts });
          }
        } else if (entry.type === "assistant" && entry.message?.content) {
          const contents = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
          for (const block of contents) {
            if (block.type === "text" && block.text && !isNoise(block.text)) {
              items.push({ kind: "assistant_message", text: block.text, id: crypto.randomBytes(3).toString("hex"), timestamp: ts });
            } else if (block.type === "thinking" && block.thinking) {
              items.push({ kind: "thought", text: block.thinking, id: crypto.randomBytes(3).toString("hex"), timestamp: ts, status: "ready" });
            } else if (block.type === "tool_use") {
              items.push({ kind: "tool_call", name: block.name, input: block.input, status: "completed", id: block.id ?? crypto.randomBytes(3).toString("hex"), timestamp: ts });
            }
          }
        }
      } catch { continue; }
    }
  } catch (err) { 
    return []; 
  }
  return items;
}

export function spawnChatAgent(projectPath: string, resumeSessionId?: string): ChatAgent {
  const id = crypto.randomBytes(3).toString("hex");
  const absolutePath = path.resolve(projectPath);

  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE;

  const args = [
    "-p",
    "--verbose",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--include-partial-messages"
  ];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  const proc = spawn(
    CLAUDE_BINARY,
    args,
    {
      cwd: absolutePath,
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  const title = resumeSessionId 
    ? (extractTitleFromHistory(absolutePath, resumeSessionId) || "Resumed Chat")
    : "New Chat";

  const entry: AgentEntry = {
    agent: {
      id,
      type: "chat",
      title,
      projectPath: absolutePath,
      status: "running",
      agentStatus: "idle",
      unreadCount: 0,
      startedAt: new Date().toISOString(),
    },
    process: proc,
    history: resumeSessionId ? loadSessionHistory(absolutePath, resumeSessionId) : [],
    subscribers: new Set(),
    isSmartNamed: resumeSessionId ? true : false 
  };

  entries.set(id, entry);

  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on("line", (line) => {
    if (line.trim()) parseClaudeEvent(line, entry);
  });

  proc.stderr?.on("data", (data) => {
    const text: string = data.toString();
    const errItem: StreamItem = {
      kind: "system",
      text: text.trim(),
      id: crypto.randomBytes(3).toString("hex"),
      timestamp: new Date().toISOString(),
    };
    entry.history.push(errItem);
    emit(entry, { type: "stream_item", item: errItem });
  });

  proc.on("error", (err) => {
    const errItem: StreamItem = {
      kind: "error",
      text: `Failed to spawn: ${err.message}`,
      id: crypto.randomBytes(3).toString("hex"),
      timestamp: new Date().toISOString(),
    };
    entry.history.push(errItem);
    emit(entry, { type: "stream_item", item: errItem });
  });

  proc.on("exit", (code) => {
    entry.agent.status = "stopped";
    entry.agent.agentStatus = code === 0 ? "done" : "error";
    emit(entry, { type: "agent_status", status: entry.agent.agentStatus });
  });

  return entry.agent;
}

export function sendMessage(agentId: string, text: string): boolean {
  const entry = entries.get(agentId);
  if (!entry || entry.agent.status !== "running") return false;

  if (entry.agent.title === "New Chat" && text.trim() && !isNoise(text)) {
    entry.agent.title = text.slice(0, 40) + (text.length > 40 ? "…" : "");
    emit(entry, { type: "chat_title_update", title: entry.agent.title });
  }

  const item: StreamItem = {
    kind: "user_message",
    text,
    id: crypto.randomBytes(3).toString("hex"),
    timestamp: new Date().toISOString(),
  };
  entry.history.push(item);
  emit(entry, { type: "stream_item", item });
  
  entry.agent.agentStatus = "thinking";
  emit(entry, { type: "agent_status", status: "thinking" });

  const msg = JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    session_id: entry.sessionId ?? "default",
    parent_tool_use_id: null,
  }) + "\n";
  entry.process.stdin!.write(msg);
  return true;
}

export function subscribeChatAgent(agentId: string, ws: WebSocket): void {
  const entry = entries.get(agentId);
  if (!entry) return;
  
  // Mark as read when someone connects
  entry.agent.unreadCount = 0;
  entry.subscribers.add(ws);
  
  ws.send(JSON.stringify({ type: "history_snapshot", items: entry.history } as ChatWsServerMessage));
  ws.send(JSON.stringify({ type: "unread_cleared" } as ChatWsServerMessage));
}

export function unsubscribeChatAgent(agentId: string, ws: WebSocket): void {
  entries.get(agentId)?.subscribers.delete(ws);
}

export function getChatAgent(id: string): ChatAgent | undefined {
  return entries.get(id)?.agent;
}

export function listChatAgents(): ChatAgent[] {
  return Array.from(entries.values()).map((e) => e.agent);
}

export function killChatAgent(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entry.process.kill("SIGINT");
  setTimeout(() => {
    try { entry.process.kill("SIGKILL"); } catch { /* ignore */ }
  }, 2000);
  entry.agent.status = "stopped";
  entries.delete(id);
}
