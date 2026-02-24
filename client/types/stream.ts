export type StreamItem =
  | { kind: "user_message"; text: string; id: string; timestamp: string }
  | { kind: "assistant_message"; text: string; id: string; timestamp: string }
  | { kind: "thought"; text: string; id: string; timestamp: string; status: "loading" | "ready" }
  | { kind: "tool_call"; name: string; input: unknown; result?: unknown; status: "running" | "completed" | "failed"; id: string; timestamp: string }
  | { kind: "error"; text: string; id: string; timestamp: string };

export type ChatWsServerMessage =
  | { type: "history_snapshot"; items: StreamItem[] }
  | { type: "stream_item"; item: StreamItem }
  | { type: "agent_status"; status: "idle" | "thinking" | "done" | "error" };

export type ChatWsClientMessage =
  | { type: "user_input"; text: string };
