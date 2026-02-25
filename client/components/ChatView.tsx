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
    item.status === "running" ? "text-amber-500" :
    item.status === "completed" ? "text-green-500" : "text-red-500";

  return (
    <div className={isTiled ? "my-0.5" : "my-1"}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors ${isTiled ? "text-[10px]" : "text-xs"}`}
      >
        <span className={`font-mono font-bold ${statusColor}`}>{statusIcon}</span>
        <span className="font-semibold">{item.name}</span>
        <span className="opacity-50">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-1 rounded-lg bg-gray-50 border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-2 py-1.5 border-b border-gray-200">
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">Input</div>
            <pre className={`whitespace-pre-wrap break-all font-mono text-gray-700 ${isTiled ? "text-[10px]" : "text-xs"}`}>
              {JSON.stringify(item.input, null, 2)}
            </pre>
          </div>
          {item.result !== undefined && (
            <div className="px-2 py-1.5">
              <div className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">Output</div>
              <pre className={`whitespace-pre-wrap break-all font-mono max-h-32 overflow-y-auto text-gray-700 ${isTiled ? "text-[10px]" : "text-xs"}`}>
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
        className={`flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors italic ${isTiled ? "text-[10px]" : "text-xs"}`}
      >
        <span>💭</span>
        <span>{expanded ? "Hide thinking" : "Show thinking"}</span>
        <span className="opacity-50">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-1 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 shadow-inner">
          <p className={`text-gray-500 italic whitespace-pre-wrap leading-relaxed ${isTiled ? "text-[10px]" : "text-xs"}`}>{item.text}</p>
        </div>
      )}
    </div>
  );
}

type MessageGroup = {
  kind: "user" | "agent" | "system" | "tool" | "thought" | "error";
  items: StreamItem[];
  timestamp: string;
};

function groupMessages(items: StreamItem[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;

  items.forEach((item) => {
    let kind: MessageGroup["kind"] = "agent";
    if (item.kind === "user_message") kind = "user";
    else if (item.kind === "system") kind = "system";
    else if (item.kind === "tool_call") kind = "tool";
    else if (item.kind === "thought") kind = "thought";
    else if (item.kind === "error") kind = "error";

    // Assistant messages and text deltas are both "agent"
    if (item.kind === "assistant_message" || item.kind === "text_delta") kind = "agent";

    const canGroup = currentGroup && 
      currentGroup.kind === kind && 
      (kind === "user" || kind === "agent");

    if (canGroup) {
      currentGroup!.items.push(item);
    } else {
      currentGroup = {
        kind,
        items: [item],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      groups.push(currentGroup);
    }
  });

  return groups;
}

function MessageBubble({ item, group, index, total }: { item: StreamItem; group: MessageGroup; index: number; total: number }) {
  if (group.kind === "user") {
    const text = (item as any).text || "";
    let radiusClass = "bubble-user-single bubble-tail";
    if (total > 1) {
      if (index === 0) radiusClass = "bubble-user-top";
      else if (index === total - 1) radiusClass = "bubble-user-bottom bubble-tail";
      else radiusClass = "bubble-user-middle";
    }

    return (
      <div className="flex justify-end mb-1">
        <div className={`glass-bubble-user text-white px-4 py-2 shadow-sm ${radiusClass} max-w-[75%]`}>
          <p className="text-[15px] leading-snug whitespace-pre-wrap break-words font-sans">{text}</p>
        </div>
      </div>
    );
  }

  if (group.kind === "agent") {
    const text = (item as any).text || "";
    return (
      <div className="flex flex-col mb-6 group/agent">
        {index === 0 && (
          <div className="flex items-center mb-2">
            <span className="text-[13px] font-bold text-gray-500 uppercase tracking-tight truncate flex-1">Agent Response</span>
          </div>
        )}
        <div className="max-w-full">
          <p className="text-[16px] leading-relaxed text-gray-900 whitespace-pre-wrap break-words font-sans">{text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "thought") {
    return <div className="mb-2"><ThoughtItem item={item} /></div>;
  }

  if (item.kind === "tool_call") {
    return <div className="mb-2"><ToolCallItem item={item} /></div>;
  }

  if (item.kind === "system") {
    return (
      <div className="flex justify-center my-4">
        <span className="text-[11px] text-gray-500 uppercase tracking-[0.2em] font-bold px-3 py-1 rounded-full bg-gray-100 border border-gray-200">
          {item.text}
        </span>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="flex justify-center my-4">
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-xl text-xs font-medium">
          {item.text}
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

  const messageGroups = groupMessages(items);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto ${isTiled ? "px-4 py-4" : "px-8 py-8"} space-y-6`}>
        {messageGroups.length === 0 && status !== "connecting" && (
          <div className="flex flex-col items-center justify-center h-full space-y-4 opacity-20">
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-white flex items-center justify-center">
              <span className="text-xl">✨</span>
            </div>
            <p className="text-sm font-medium tracking-wide">NEW CONVERSATION</p>
          </div>
        )}
        
        {messageGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1">
            {group.items.map((item, iIdx) => (
              <MessageBubble 
                key={item.id + iIdx} 
                item={item} 
                group={group} 
                index={iIdx} 
                total={group.items.length} 
              />
            ))}
          </div>
        ))}

        {isThinking && (
          <div className="flex justify-start items-center ml-2 mb-4">
            <div className="flex gap-1 px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className={`flex-shrink-0 ${isTiled ? "p-4" : "p-6"}`}>
        <div className="glass-input rounded-[28px] p-1 flex items-end shadow-sm bg-white border border-gray-300">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTiled ? "Reply..." : "iMessage"}
            rows={1}
            disabled={status === "connecting" || status === "error"}
            className={`flex-1 resize-none bg-transparent border-none text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 transition-all max-h-48 overflow-y-auto disabled:opacity-40 py-2.5 ${
              isTiled ? "px-4 text-[14px]" : "px-5 text-[16px]"
            }`}
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={sendUserMessage}
            disabled={!canSend && input.trim().length > 0}
            className={`flex-shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ease-out mb-1 mr-1 ${
              input.trim().length > 0 
                ? "w-8 h-8 bg-[#007AFF] text-white scale-100 opacity-100 shadow-md shadow-[#007AFF]/20" 
                : "w-8 h-8 bg-gray-100 text-gray-400 scale-90 opacity-100"
            }`}
            aria-label="Send"
          >
            {input.trim().length > 0 ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v4"/><path d="M8 23h8"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
