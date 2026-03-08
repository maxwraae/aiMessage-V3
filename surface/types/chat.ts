export interface UserMessage {
  id: string;
  kind: "user";
  text: string;
  timestamp: number;
}

export interface AgentMessage {
  id: string;
  kind: "agent";
  /** Markdown-ish text. Code fences rendered as CodeBlocks. */
  text: string;
  /** Inline trace summary, rendered as muted text at the end of the last prose line. */
  whisper?: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  kind: "tool_call";
  name: string;
  input: Record<string, any>;
  result?: string;
  status: "running" | "completed" | "failed";
  timestamp: number;
}

export interface ImageFigure {
  id: string;
  kind: "image";
  uri: string;
  width: number;
  height: number;
  caption?: string;
  timestamp: number;
}

export interface FileFigure {
  id: string;
  kind: "file";
  name: string;
  size: string;
  mimeType?: string;
  timestamp: number;
}

export type ChatMessage = UserMessage | AgentMessage | ToolCall | ImageFigure | FileFigure;

export interface ChatSession {
  id: string;
  name: string;
  status: "idle" | "thinking" | "needs-input" | "resolved" | "failed";
  messages: ChatMessage[];
}
