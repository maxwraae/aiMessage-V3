import { spawn, ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import * as readline from "node:readline";
import * as crypto from "node:crypto";
import * as os from "node:os";
import type { WebSocket } from "ws";
import type { StreamItem, ChatWsServerMessage } from "./shared/stream-types.js";

export type ChatAgent = {
  id: string;
  type: "chat";
  projectPath: string;
  companionSession: string; // tmux session name for terminal toggle
  status: "running" | "stopped";
  startedAt: string;
};

type AgentEntry = {
  agent: ChatAgent;
  process: ChildProcess;
  history: StreamItem[];
  subscribers: Set<WebSocket>;
};

const entries = new Map<string, AgentEntry>();

function emit(entry: AgentEntry, msg: ChatWsServerMessage) {
  const json = JSON.stringify(msg);
  for (const ws of entry.subscribers) {
    if ((ws as any).readyState === 1 /* OPEN */) ws.send(json);
  }
}

function parseClaudeEvent(line: string, entry: AgentEntry) {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  const ts = new Date().toISOString();

  if (event.type === "assistant" && event.message?.content) {
    for (const block of event.message.content as any[]) {
      let item: StreamItem | null = null;

      if (block.type === "text" && block.text) {
        item = {
          kind: "assistant_message",
          text: block.text,
          id: crypto.randomBytes(3).toString("hex"),
          timestamp: ts,
        };
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
    emit(entry, { type: "agent_status", status: "idle" });
  }
}

export function spawnChatAgent(projectPath: string): ChatAgent {
  const id = crypto.randomBytes(3).toString("hex");
  const companionSession = `agent-${id}-term`;

  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE;

  // Companion tmux session: bash in project dir, for terminal toggle
  try {
    execSync(`tmux new-session -d -s ${companionSession} -c "${projectPath}"`, {
      env: env as NodeJS.ProcessEnv,
    });
  } catch {
    // ignore if already exists
  }

  const proc = spawn(
    "claude",
    [
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
    ],
    {
      cwd: projectPath,
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  const agent: ChatAgent = {
    id,
    type: "chat",
    projectPath,
    companionSession,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  const entry: AgentEntry = {
    agent,
    process: proc,
    history: [],
    subscribers: new Set(),
  };

  entries.set(id, entry);

  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on("line", (line) => {
    if (line.trim()) parseClaudeEvent(line, entry);
  });

  proc.stderr?.on("data", (data) => {
    const text: string = data.toString();
    // Emit stderr as error items so they're visible in the chat
    const errItem: StreamItem = {
      kind: "error",
      text: text.trim(),
      id: crypto.randomBytes(3).toString("hex"),
      timestamp: new Date().toISOString(),
    };
    entry.history.push(errItem);
    emit(entry, { type: "stream_item", item: errItem });
  });

  proc.on("exit", (code) => {
    agent.status = "stopped";
    emit(entry, { type: "agent_status", status: code === 0 ? "done" : "error" });
  });

  return agent;
}

export function sendMessage(agentId: string, text: string): boolean {
  const entry = entries.get(agentId);
  if (!entry || entry.agent.status !== "running") return false;

  const item: StreamItem = {
    kind: "user_message",
    text,
    id: crypto.randomBytes(3).toString("hex"),
    timestamp: new Date().toISOString(),
  };
  entry.history.push(item);
  emit(entry, { type: "stream_item", item });
  emit(entry, { type: "agent_status", status: "thinking" });

  const msg = JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";
  entry.process.stdin!.write(msg);
  return true;
}

export function subscribeChatAgent(agentId: string, ws: WebSocket): void {
  const entry = entries.get(agentId);
  if (!entry) return;
  entry.subscribers.add(ws);
  // Send history snapshot immediately
  ws.send(JSON.stringify({ type: "history_snapshot", items: entry.history } as ChatWsServerMessage));
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
  const env = { ...process.env };
  try {
    execSync(`tmux kill-session -t ${entry.agent.companionSession}`, {
      stdio: "ignore",
      env,
    });
  } catch { /* ignore */ }
  entries.delete(id);
}
