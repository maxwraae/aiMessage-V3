import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamItem, ChatWsServerMessage, ChatWsClientMessage } from "../types/stream";

type AgentStatus = "idle" | "thinking" | "done" | "error" | "connecting";

type ToolCallItemProps = {
  item: Extract<StreamItem, { kind: "tool_call" }>;
  isTiled?: boolean;
};

function ToolCallItem({ item, isTiled }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    item.status === "running" ? "bg-amber-400" :
    item.status === "completed" ? "bg-green-500" : "bg-red-500";

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 group/tool"
      >
        <div className={`w-1.5 h-1.5 rounded-full ${statusColor} shadow-sm`} />
        <span className="text-[13px] font-medium text-gray-400 group-hover/tool:text-gray-600 transition-colors">
          {item.name}
        </span>
        <svg 
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" 
          className={`text-gray-300 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        >
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </button>
      {expanded && (
        <div className="mt-2 ml-3 pl-3 border-l border-gray-100 space-y-3">
          <div>
            <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-1">Input</div>
            <pre className="text-[12px] text-gray-500 font-mono bg-gray-50/50 p-2 rounded-lg border border-black/[0.03] overflow-x-auto">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          </div>
          {item.result !== undefined && (
            <div>
              <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-1">Output</div>
              <pre className="text-[12px] text-gray-500 font-mono bg-gray-50/50 p-2 rounded-lg border border-black/[0.03] overflow-x-auto max-h-40">
                {typeof item.result === "string" ? item.result : JSON.stringify(item.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThoughtItem({ item, isTiled }: ThoughtItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 group/thought"
      >
        <span className="text-[13px] font-medium text-gray-400 group-hover/thought:text-gray-600 transition-colors">
          Reasoning
        </span>
        <svg 
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" 
          className={`text-gray-300 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        >
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </button>
      {expanded && (
        <div className="mt-2 ml-3 pl-3 border-l border-gray-100">
          <p className="text-[14px] leading-relaxed text-gray-500 italic font-sans">{item.text}</p>
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
          <p className="text-[17px] leading-snug whitespace-pre-wrap break-words font-sans">{text}</p>
        </div>
      </div>
    );
  }

  if (group.kind === "agent") {
    const text = (item as any).text || "";
    let radiusClass = "rounded-2xl rounded-bl-sm bubble-agent-tail"; // Default tail look
    if (total > 1) {
      if (index === 0) radiusClass = "rounded-t-2xl rounded-br-2xl rounded-bl-sm";
      else if (index === total - 1) radiusClass = "rounded-b-2xl rounded-tr-2xl rounded-bl-sm bubble-agent-tail";
      else radiusClass = "rounded-l-sm rounded-r-2xl";
    }

    return (
      <div className="flex flex-col mb-1 group/agent items-start">
        {index === 0 && (
          <div className="flex items-center mb-1 ml-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate flex-1">Agent Response</span>
          </div>
        )}
        <div className={`bg-[#E9E9EB] text-black px-4 py-2 shadow-sm ${radiusClass} max-w-[85%]`}>
          <p className="text-[17px] leading-relaxed whitespace-pre-wrap break-words font-sans">{text}</p>
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
    <div className="flex flex-col h-full bg-transparent min-h-0">
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto ${isTiled ? "px-4 py-4" : "px-8 py-8"} space-y-6 min-h-0 touch-pan-y`}>
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
      <div className={`flex-shrink-0 ${isTiled ? "px-2 py-3" : "px-4 py-4"} bg-white`}>
        <div className="flex items-center gap-2">
          {/* Action Button (+) */}
          <button className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>

          {/* Text Input Pill */}
          <div className="flex-1 glass-input rounded-[22px] flex items-end bg-white border border-gray-200 py-1.5 px-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="iMessage"
              rows={1}
              disabled={status === "connecting" || status === "error"}
              className="flex-1 resize-none bg-transparent border-none text-[17px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 transition-all max-h-48 overflow-y-auto px-4 py-1"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            {/* Mic inside pill (only if no text) */}
            {!input.trim() && (
              <div className="px-2 pb-1 text-gray-400">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v4"/><path d="M8 23h8"/>
                </svg>
              </div>
            )}
          </div>

          {/* Send Arrow (outside pill, only if text exists) */}
          {input.trim() && (
            <button
              onClick={sendUserMessage}
              disabled={!canSend}
              className="w-10 h-10 rounded-full bg-[#007AFF] text-white flex items-center justify-center shadow-md shadow-[#007AFF]/20 active:scale-95 transition-transform"
              aria-label="Send"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
