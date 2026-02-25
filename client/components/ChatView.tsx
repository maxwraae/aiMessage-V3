import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamItem, ChatWsServerMessage, ChatWsClientMessage } from "../types/stream";

type AgentStatus = "idle" | "thinking" | "done" | "error" | "connecting";

type ToolCallItemProps = {
  item: Extract<StreamItem, { kind: "tool_call" }>;
  isTiled?: boolean;
};

function ToolCallItem({ item, isTiled }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon =
    item.status === "running" ? "⋯" :
    item.status === "completed" ? "✓" : "✗";

  const statusColor =
    item.status === "running" ? "text-[#e0af68]" :
    item.status === "completed" ? "text-[#9ece6a]" : "text-[#f7768e]";

  return (
    <div className={isTiled ? "my-0.5" : "my-1"}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-2 text-[#565f89] hover:text-[#a9b1d6] transition-colors ${isTiled ? "text-[10px]" : "text-xs"}`}
      >
        <span className={`font-mono ${statusColor}`}>{statusIcon}</span>
        <span className="font-medium">{item.name}</span>
        <span className="opacity-50">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className={`mt-1 ml-2 rounded-md bg-[#16161e] border border-[#292e42] overflow-hidden ${isTiled ? "ml-2" : "ml-4"}`}>
          <div className="px-2 py-1.5 border-b border-[#292e42]">
            <div className="text-[9px] text-[#565f89] uppercase tracking-wide mb-0.5">Input</div>
            <pre className={`whitespace-pre-wrap break-all font-mono ${isTiled ? "text-[10px]" : "text-xs text-[#a9b1d6]"}`}>
              {JSON.stringify(item.input, null, 2)}
            </pre>
          </div>
          {item.result !== undefined && (
            <div className="px-2 py-1.5">
              <div className="text-[9px] text-[#565f89] uppercase tracking-wide mb-0.5">Output</div>
              <pre className={`whitespace-pre-wrap break-all font-mono max-h-32 overflow-y-auto ${isTiled ? "text-[10px]" : "text-xs text-[#a9b1d6]"}`}>
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
  isTiled?: boolean;
};

function ThoughtItem({ item, isTiled }: ThoughtItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={isTiled ? "my-0.5" : "my-1"}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-2 text-[#414868] hover:text-[#565f89] transition-colors italic ${isTiled ? "text-[10px]" : "text-xs"}`}
      >
        <span>💭</span>
        <span>{expanded ? "Hide thinking" : "Show thinking"}</span>
        <span className="opacity-50">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className={`mt-1 px-2 py-1.5 rounded-md bg-[#16161e] border border-[#1f2335] ${isTiled ? "ml-2" : "ml-4"}`}>
          <p className={`text-[#414868] italic whitespace-pre-wrap ${isTiled ? "text-[10px]" : "text-xs"}`}>{item.text}</p>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ item, isTiled }: { item: StreamItem; isTiled?: boolean }) {
  if (item.kind === "user_message") {
    return (
      <div className={`flex justify-end ${isTiled ? "mb-2" : "mb-3"}`}>
        <div className={`rounded-2xl rounded-tr-sm bg-[#3d59a1] text-[#c0caf5] ${isTiled ? "max-w-[90%] px-3 py-1.5" : "max-w-[75%] px-4 py-2.5"}`}>
          <p className={`whitespace-pre-wrap break-words ${isTiled ? "text-xs" : "text-sm"}`}>{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "assistant_message") {
    return (
      <div className={`flex justify-start ${isTiled ? "mb-2" : "mb-3"}`}>
        <div className={`rounded-2xl rounded-tl-sm bg-[#1f2335] text-[#a9b1d6] ${isTiled ? "max-w-[95%] px-3 py-1.5" : "max-w-[85%] px-4 py-2.5"}`}>
          <p className={`whitespace-pre-wrap break-words ${isTiled ? "text-xs" : "text-sm"}`}>{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "text_delta") {
    return (
      <div className="flex justify-start mb-1">
        <div className={`rounded-2xl bg-[#1f2335]/50 text-[#a9b1d6] border border-[#292e42]/30 ${isTiled ? "max-w-[95%] px-3 py-1" : "max-w-[85%] px-4 py-2"}`}>
          <p className={`whitespace-pre-wrap break-words ${isTiled ? "text-xs" : "text-sm"}`}>{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "thought") {
    return (
      <div className={`${isTiled ? "mb-1" : "mb-2"} px-1`}>
        <ThoughtItem item={item} isTiled={isTiled} />
      </div>
    );
  }

  if (item.kind === "tool_call") {
    return (
      <div className={`${isTiled ? "mb-1" : "mb-1.5"} px-1`}>
        <ToolCallItem item={item} isTiled={isTiled} />
      </div>
    );
  }

  if (item.kind === "system") {
    return (
      <div className={`my-1 px-2 py-1 rounded bg-[#16161e] border-l-2 border-[#565f89] ${isTiled ? "opacity-50" : "opacity-70"}`}>
        <p className={`font-mono text-[#565f89] whitespace-pre-wrap break-all ${isTiled ? "text-[9px]" : "text-[10px]"}`}>
          {item.text}
        </p>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className={`flex justify-start ${isTiled ? "mb-2" : "mb-3"}`}>
        <div className={`rounded-lg bg-[#2d1b21] border border-[#f7768e]/30 text-[#f7768e] ${isTiled ? "max-w-[95%] px-3 py-1.5" : "max-w-[85%] px-4 py-2.5"}`}>
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
  isTiled?: boolean;
};

export default function ChatView({ agentId, onTitleUpdate, onUnreadReset, isTiled }: Props) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("connecting");
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const upsertItem = useCallback((item: StreamItem) => {
    setItems((prev) => {
      if (item.kind === "tool_call") {
        const idx = prev.findIndex((i) => i.kind === "tool_call" && i.id === item.id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = item;
          return next;
        }
      }
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
      <div className={`flex-1 overflow-y-auto ${isTiled ? "px-2 py-2" : "px-4 py-4"}`}>
        {items.length === 0 && status !== "connecting" && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[#414868]">Send a message to start</p>
          </div>
        )}
        {items.map((item, idx) => (
          <MessageBubble key={item.id + idx} item={item} isTiled={isTiled} />
        ))}
        {isThinking && (
          <div className={`flex justify-start ${isTiled ? "mb-2" : "mb-3"}`}>
            <div className={`rounded-2xl rounded-tl-sm bg-[#1f2335] ${isTiled ? "px-3 py-1.5" : "px-4 py-2.5"}`}>
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
      <div className={`flex-shrink-0 border-t border-[#292e42] bg-[#16161e] ${isTiled ? "px-2 py-2" : "px-4 py-3"}`}>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTiled ? "Reply..." : "Message Claude…"}
            rows={1}
            disabled={status === "connecting" || status === "error"}
            className={`flex-1 resize-none bg-[#1f2335] border border-[#292e42] rounded-xl text-[#c0caf5] placeholder-[#414868] focus:outline-none focus:border-[#3d59a1] transition-colors max-h-36 overflow-y-auto disabled:opacity-40 ${
              isTiled ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"
            }`}
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={sendUserMessage}
            disabled={!canSend}
            className={`flex-shrink-0 rounded-xl bg-[#3d59a1] text-[#c0caf5] flex items-center justify-center hover:bg-[#4a6dbf] disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${
              isTiled ? "w-7 h-7" : "w-9 h-9"
            }`}
            aria-label="Send"
          >
            <svg width={isTiled ? "10" : "14"} height={isTiled ? "10" : "14"} viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 7L7 13M13 7H1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {status === "error" && !isTiled && (
          <p className="text-xs text-[#f7768e] mt-1.5">Connection lost</p>
        )}
      </div>
    </div>
  );
}
