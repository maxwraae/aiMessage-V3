export type StreamItem =
  | { kind: "user_message"; text: string; id: string; timestamp: string }
  | { kind: "assistant_message"; text: string; id: string; timestamp: string }
  | { kind: "thought"; text: string; id: string; timestamp: string; status: "loading" | "ready" }
  | { kind: "tool_call"; name: string; input: unknown; result?: unknown; status: "running" | "completed" | "failed"; id: string; timestamp: string }
  | { kind: "error"; text: string; id: string; timestamp: string }
  | { kind: "system"; text: string; id: string; timestamp: string }
  | { kind: "notification"; subject: string; id: string; timestamp: string };

export type ChatWsServerMessage =
  | { type: "history_snapshot"; items: StreamItem[] }
  | { type: "stream_item"; item: StreamItem }
  | { type: "agent_status"; status: "idle" | "thinking" | "done" | "error" }
  | { type: "chat_title_update"; title: string }
  | { type: "unread_cleared" }
  | { type: "context_cleared" }
  | { type: "plan_mode_entered" };

export type ChatWsClientMessage =
  | { type: "user_input"; text: string };
