import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamItem, ChatWsServerMessage, ChatWsClientMessage } from "../types/stream";

type AgentStatus = "idle" | "thinking" | "done" | "error" | "connecting";

type ToolCallItemProps = {
  item: Extract<StreamItem, { kind: "tool_call" }>;
};

function ToolCallItem({ item }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon =
    item.status === "running" ? "⋯" :
    item.status === "completed" ? "✓" : "✗";

  const statusColor =
    item.status === "running" ? "text-[#e0af68]" :
    item.status === "completed" ? "text-[#9ece6a]" : "text-[#f7768e]";

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-xs text-[#565f89] hover:text-[#a9b1d6] transition-colors"
      >
        <span className={`font-mono ${statusColor}`}>{statusIcon}</span>
        <span className="font-medium">{item.name}</span>
        <span className="opacity-50">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 rounded-md bg-[#16161e] border border-[#292e42] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#292e42]">
            <div className="text-[10px] text-[#565f89] uppercase tracking-wide mb-1">Input</div>
            <pre className="text-xs text-[#a9b1d6] whitespace-pre-wrap break-all font-mono">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          </div>
          {item.result !== undefined && (
            <div className="px-3 py-2">
              <div className="text-[10px] text-[#565f89] uppercase tracking-wide mb-1">Output</div>
              <pre className="text-xs text-[#a9b1d6] whitespace-pre-wrap break-all font-mono max-h-48 overflow-y-auto">
                {typeof item.result === "string"
                  ? item.result
                  : JSON.stringify(item.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ThoughtItemProps = {
  item: Extract<StreamItem, { kind: "thought" }>;
};

function ThoughtItem({ item }: ThoughtItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-xs text-[#414868] hover:text-[#565f89] transition-colors italic"
      >
        <span>💭</span>
        <span>{expanded ? "Hide thinking" : "Show thinking"}</span>
        <span className="opacity-50">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 px-3 py-2 rounded-md bg-[#16161e] border border-[#1f2335]">
          <p className="text-xs text-[#414868] italic whitespace-pre-wrap">{item.text}</p>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ item }: { item: StreamItem }) {
  if (item.kind === "user_message") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 bg-[#3d59a1] text-[#c0caf5]">
          <p className="text-sm whitespace-pre-wrap break-words">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "assistant_message") {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 bg-[#1f2335] text-[#a9b1d6]">
          <p className="text-sm whitespace-pre-wrap break-words">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "text_delta") {
    return (
      <div className="flex justify-start mb-1">
        <div className="max-w-[85%] rounded-2xl px-4 py-2 bg-[#1f2335]/50 text-[#a9b1d6] border border-[#292e42]/30">
          <p className="text-sm whitespace-pre-wrap break-words">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "thought") {
    return (
      <div className="mb-2 px-1">
        <ThoughtItem item={item} />
      </div>
    );
  }

  if (item.kind === "tool_call") {
    return (
      <div className="mb-1.5 px-1">
        <ToolCallItem item={item} />
      </div>
    );
  }

  if (item.kind === "system") {
    return (
      <div className="my-2 px-3 py-2 rounded bg-[#16161e] border-l-2 border-[#565f89]">
        <p className="text-[10px] font-mono text-[#565f89] whitespace-pre-wrap break-all opacity-70">
          {item.text}
        </p>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[85%] rounded-lg px-4 py-2.5 bg-[#2d1b21] border border-[#f7768e]/30 text-[#f7768e]">
          <p className="text-xs whitespace-pre-wrap break-words">{item.text}</p>
        </div>
      </div>
    );
  }

  return null;
}

type Props = { 
  agentId: string;
  onTitleUpdate?: (title: string) => void;
  onUnreadReset?: () => void;
};

export default function ChatView({ agentId, onTitleUpdate, onUnreadReset }: Props) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("connecting");
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Deduplicate and update items
  const upsertItem = useCallback((item: StreamItem) => {
    setItems((prev) => {
      // Update tool calls
      if (item.kind === "tool_call") {
        const idx = prev.findIndex((i) => i.kind === "tool_call" && i.id === item.id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = item;
          return next;
        }
      }
      
      // Merge consecutive text deltas if they share the same ID (unlikely but possible)
      // Or just append
      return [...prev, item];
    });
  }, []);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws/chat/${agentId}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as ChatWsServerMessage;
        if (msg.type === "history_snapshot") {
          setItems(msg.items);
          setStatus("idle");
        } else if (msg.type === "stream_item") {
          upsertItem(msg.item);
        } else if (msg.type === "agent_status") {
          setStatus(msg.status);
        } else if (msg.type === "chat_title_update") {
          onTitleUpdate?.(msg.title);
        } else if (msg.type === "unread_cleared") {
          onUnreadReset?.();
        }
      } catch { /* ignore */ }
    };

    ws.onopen = () => setStatus("idle");
    ws.onclose = () => setStatus("error");

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [agentId, upsertItem]);

  // Auto-scroll on new items
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  function sendUserMessage() {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const msg: ChatWsClientMessage = { type: "user_input", text };
    wsRef.current.send(JSON.stringify(msg));
    setInput("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  }

  const isThinking = status === "thinking";
  const canSend = input.trim().length > 0 && status !== "thinking" && status !== "connecting";

  return (
    <div className="flex flex-col h-full bg-[#1a1b26]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 && status !== "connecting" && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[#414868]">Send a message to start</p>
          </div>
        )}
        {items.map((item, idx) => (
          <MessageBubble key={item.id + idx} item={item} />
        ))}
        {isThinking && (
          <div className="flex justify-start mb-3">
            <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-[#1f2335]">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#565f89] animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#565f89] animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#565f89] animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 border-t border-[#292e42] bg-[#16161e] px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude…"
            rows={1}
            disabled={status === "connecting" || status === "error"}
            className="flex-1 resize-none bg-[#1f2335] border border-[#292e42] rounded-xl px-4 py-2.5 text-sm text-[#c0caf5] placeholder-[#414868] focus:outline-none focus:border-[#3d59a1] transition-colors max-h-36 overflow-y-auto disabled:opacity-40"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={sendUserMessage}
            disabled={!canSend}
            className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#3d59a1] text-[#c0caf5] flex items-center justify-center hover:bg-[#4a6dbf] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 7L7 13M13 7H1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {status === "error" && (
          <p className="text-xs text-[#f7768e] mt-1.5">Connection lost</p>
        )}
      </div>
    </div>
  );
}
