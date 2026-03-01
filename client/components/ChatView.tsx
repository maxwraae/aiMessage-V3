import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamItem, ChatWsServerMessage, ChatWsClientMessage } from "../types/stream";

type ContextClearMarker = { kind: "context_clear"; id: string; timestamp: string };
type PlanModeMarker = { kind: "plan_mode"; id: string; timestamp: string };
type DisplayItem = StreamItem | ContextClearMarker | PlanModeMarker;

type AgentStatus = "idle" | "thinking" | "done" | "error" | "connecting" | "nudge";

type MessageGroup =
  | {
      kind: "user" | "agent" | "system" | "tool" | "thought" | "error" | "notification";
      items: StreamItem[];
      timestamp: string;
    }
  | { kind: "context_clear"; id: string; timestamp: string }
  | { kind: "plan_mode"; id: string; timestamp: string };

function groupMessages(items: DisplayItem[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentGroup: Extract<MessageGroup, { items: StreamItem[] }> | null = null;

  items.filter(item => item.kind !== "thought").forEach((item) => {
    if (item.kind === "context_clear") {
      currentGroup = null;
      groups.push({ kind: "context_clear", id: item.id, timestamp: item.timestamp });
      return;
    }

    if (item.kind === "plan_mode") {
      currentGroup = null;
      groups.push({ kind: "plan_mode", id: item.id, timestamp: item.timestamp });
      return;
    }

    let kind: Extract<MessageGroup, { items: StreamItem[] }>["kind"] = "agent";
    if (item.kind === "user_message") kind = "user";
    else if (item.kind === "system") kind = "system";
    else if (item.kind === "tool_call") kind = "tool";
    else if (item.kind === "error") kind = "error";
    else if (item.kind === "notification") kind = "notification";

    if (item.kind === "assistant_message" || item.kind === "text_delta" || item.kind === "thought") kind = "agent";

    const canGroup = currentGroup &&
      currentGroup.kind === kind &&
      (kind === "user" || kind === "agent");

    if (canGroup) {
      currentGroup!.items.push(item as StreamItem);
    } else {
      currentGroup = {
        kind,
        items: [item as StreamItem],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      groups.push(currentGroup);
    }
  });

  return groups;
}

function ToolCallItem({ item }: { item: Extract<StreamItem, { kind: "tool_call" }> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full my-2">
      <div className="bg-gray-50/50 border border-black/[0.03] rounded-lg overflow-hidden shadow-sm">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-black/[0.02] transition-colors group/tool text-left"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              {item.name.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] text-gray-400 font-medium lowercase">
              {item.status === "running" ? "running..." : item.status === "completed" ? "done" : "failed"}
            </span>
          </div>
          <svg 
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" 
            className={`text-gray-300 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          >
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
        {expanded && (
          <div className="px-3 pb-3 space-y-2 pt-1 border-t border-black/[0.02]">
            <div className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Input</div>
            <pre className="text-[11px] text-gray-600 font-mono bg-white/50 p-2 rounded border border-black/[0.01] overflow-x-auto">
              {JSON.stringify(item.input, null, 2)}
            </pre>
            {item.result !== undefined && (
              <>
                <div className="text-[9px] font-bold text-gray-300 uppercase tracking-widest mt-2">Result</div>
                <pre className="text-[11px] text-gray-600 font-mono bg-white/50 p-2 rounded border border-black/[0.01] overflow-x-auto max-h-40">
                  {typeof item.result === "string" ? item.result : JSON.stringify(item.result, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ item, group, index, total }: { item: StreamItem; group: Extract<MessageGroup, { items: StreamItem[] }>; index: number; total: number }) {
  if (item.kind === "tool_call") {
    return <ToolCallItem item={item} />;
  }

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
        <div className={`glass-bubble-user text-white px-4 py-2 shadow-sm ${radiusClass} max-w-[85%] lg:max-w-[75%]`}>
          <p className="text-[17px] leading-snug whitespace-pre-wrap break-words font-sans antialiased">{text}</p>
        </div>
      </div>
    );
  }

  if (group.kind === "agent") {
    const text = (item as any).text || "";

    return (
      <div className="flex flex-col mb-4 items-start w-full">
        {index === 0 && (
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">Agent</div>
        )}
        <div className="w-full max-w-full overflow-x-hidden">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            className="text-[17px] leading-relaxed text-gray-900 font-sans antialiased"
            components={{
              p: ({children}) => <p className="mb-3 last:mb-0">{children}</p>,
              ul: ({children}) => <ul className="list-disc pl-6 mb-3">{children}</ul>,
              ol: ({children}) => <ol className="list-decimal pl-6 mb-3">{children}</ol>,
              li: ({children}) => <li className="mb-1">{children}</li>,
              code: ({node, ...props}) => <code className="bg-gray-100 px-1 rounded text-[15px] font-mono" {...props} />,
              strong: ({children}) => <span className="font-bold text-black">{children}</span>
            }}
          >
            {text}
          </ReactMarkdown>
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
  onStatusChange?: (sessionId: string, status: string) => void;
  onModelSwitch?: (model: string) => void;
  currentModel?: string;
  isTiled?: boolean;
};

export default function ChatView({ agentId, onTitleUpdate, onUnreadReset, onStatusChange, onModelSwitch, currentModel, isTiled }: Props) {
  console.log(`[ChatView] Mounting for agent ${agentId}`);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("connecting");
  const [input, setInput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  // Text buffering for phrase-cluster streaming
  const textBufferRef = useRef<string>("");
  const flushTimerRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-3), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If we're within 50px of the bottom, consider it "at bottom"
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  async function startRecording() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone access is not supported in this browser or context (e.g. requires HTTPS).");
        return;
      }
      if (isRecording) { stopRecording(); return; }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setIsRecording(false);
        setIsTranscribing(true);
        const formData = new FormData();
        formData.append("audio", audioBlob);
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: formData });
          const { text } = await res.json();
          if (text) setInput(prev => prev + (prev ? " " : "") + text);
        } catch (err) { console.error("Transcription failed:", err); }
        finally { setIsTranscribing(false); }
      };
      recorder.start();
      setIsRecording(true);
      recordingTimeoutRef.current = setTimeout(() => stopRecording(), 30000);
    } catch (err) { console.error("Mic access denied:", err); }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
  }

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, []);

  useEffect(() => { adjustHeight(); }, [input, adjustHeight]);
  
  useEffect(() => { 
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" }); 
    }
  }, [items]);

  const connectedAgentIdRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onTitleUpdate, onUnreadReset, onStatusChange });

  useEffect(() => {
    callbacksRef.current = { onTitleUpdate, onUnreadReset, onStatusChange };
  }, [onTitleUpdate, onUnreadReset, onStatusChange]);

  useEffect(() => {
    if (connectedAgentIdRef.current === agentId) return;
    connectedAgentIdRef.current = agentId;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws/chat/${agentId}`);
    wsRef.current = ws;

    // Flush buffered text to items state as one chunk
    const flushBuffer = () => {
      const buffered = textBufferRef.current;
      if (!buffered) return;
      console.log(`[TextBuffer] FLUSH: "${buffered.substring(0, 50)}..." (${buffered.length} chars)`);
      textBufferRef.current = "";
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setItems((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "assistant_message" && last.id === "streaming") {
          const next = [...prev];
          next[next.length - 1] = { ...last, text: (last.text || "") + buffered };
          return next;
        } else {
          return [...prev, {
            kind: "assistant_message" as const,
            text: buffered,
            id: "streaming",
            timestamp: new Date().toISOString()
          }];
        }
      });
    };

    ws.onopen = () => {
      setStatus("idle");
      addLog("CONNECTED");
    };
    ws.onmessage = (e) => {
      addLog(`RECV: ${e.data.substring(0, 50)}...`);
      try {
        const msg = JSON.parse(e.data) as ChatWsServerMessage;
        if (msg.type === "history_snapshot") {
          console.log(`[WS] Received history_snapshot with ${msg.items.length} items`);
          setItems(msg.items);
        } else if (msg.type === "stream_item") {
          const item = msg.item;

          // Buffer text deltas — release in phrase clusters
          if (item.kind === "text_delta") {
            textBufferRef.current += item.text;
            if (textBufferRef.current.length > 30) {
              // Buffer is big enough — flush immediately
              flushBuffer();
            } else {
              // Schedule a flush in 150ms if not already scheduled
              if (flushTimerRef.current === null) {
                flushTimerRef.current = window.setTimeout(() => {
                  flushTimerRef.current = null;
                  flushBuffer();
                }, 150);
              }
            }
            return;
          }

          // When assistant_message arrives, discard buffer first (it has the complete text)
          if (item.kind === "assistant_message") {
            if (flushTimerRef.current !== null) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            textBufferRef.current = "";
          }

          setItems((prev) => {
            // Convert streaming block to final message when assistant_message arrives
            if (item.kind === "assistant_message") {
              const filtered = prev.filter(i => i.id !== "streaming");
              return [...filtered, item];
            }

            // If it's a tool call that already exists, update it. Otherwise append.
            if (item.kind === "tool_call") {
              const existingIdx = prev.findIndex(i => i.kind === "tool_call" && i.id === item.id);
              if (existingIdx !== -1) {
                const next = [...prev];
                next[existingIdx] = item;
                return next;
              }
            }
            return [...prev, item];
          });
        } else if (msg.type === "agent_status") {
          const newStatus = msg.status as AgentStatus;
          console.log(`[StatusChange] ${agentId} → ${newStatus}`);
          setStatus(newStatus);
          callbacksRef.current.onStatusChange?.(agentId, newStatus);
          // On idle, flush any remaining buffered text
          if (newStatus === "idle" || newStatus === "done") {
            flushBuffer();
          }
        } else if (msg.type === "chat_title_update") {
          callbacksRef.current.onTitleUpdate?.(msg.title);
        } else if (msg.type === "unread_cleared") {
          callbacksRef.current.onUnreadReset?.();
        } else if (msg.type === "context_cleared") {
          setItems((prev) => [
            ...prev,
            {
              kind: "context_clear" as const,
              id: `ctx-clear-${Date.now()}`,
              timestamp: new Date().toISOString(),
            },
          ]);
          setStatus("idle");
        } else if (msg.type === "plan_mode_entered") {
          setItems((prev) => [
            ...prev,
            {
              kind: "plan_mode" as const,
              id: `plan-mode-${Date.now()}`,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      setStatus("error");
      addLog("CLOSED");
      if (connectedAgentIdRef.current === agentId) {
        connectedAgentIdRef.current = null;
      }
    };

    return () => {
      ws.close();
      if (connectedAgentIdRef.current === agentId) {
        connectedAgentIdRef.current = null;
      }
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [agentId]);

  const stopGeneration = useCallback(async () => {
    await fetch(`/api/agents/${agentId}`, { method: "DELETE" }).catch(() => {});
  }, [agentId]);

  const send = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog("SEND BLOCKED");
      return;
    }

    addLog("SENDING...");
    wsRef.current.send(JSON.stringify({ type: "user_input", text }));
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    isAtBottom.current = true; // Force scroll to bottom on send
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const messageGroups = groupMessages(items);

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden">
      {/* Internal Log Overlay (Diagnostic Eyes) */}
      <div className="absolute top-20 right-4 w-64 max-h-48 overflow-y-auto bg-black/80 backdrop-blur text-[10px] text-green-400 p-2 rounded-lg z-50 pointer-events-none font-mono shadow-2xl border border-white/10">
        <div className="text-white border-b border-white/20 pb-1 mb-1 font-bold">SYSTEM LOG ({status})</div>
        {logs.map((log, i) => (
          <div key={i} className="mb-0.5 opacity-80 leading-tight">
            {log}
          </div>
        ))}
        {items.length === 0 && <div className="text-amber-400 italic">No messages in buffer</div>}
        {items.length > 0 && <div className="text-blue-400">{items.length} frames received</div>}
      </div>


      {/* Messages */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-10 py-6 space-y-4 touch-pan-y overscroll-contain"
      >
        {messageGroups.map((group, gIdx) => {
          if (group.kind === "context_clear") {
            return (
              <div key={group.id} className="flex items-center gap-3 py-4 px-2">
                <div className="h-px flex-1 bg-black/10" />
                <span className="text-[11px] text-gray-400 font-medium whitespace-nowrap tracking-wide">Context cleared</span>
                <div className="h-px flex-1 bg-black/10" />
              </div>
            );
          }
          if (group.kind === "plan_mode") {
            return (
              <div key={group.id} className="flex items-center gap-3 py-4 px-2">
                <div className="h-px flex-1 bg-amber-300/40" />
                <span className="text-[11px] text-amber-600/70 font-medium whitespace-nowrap tracking-wide">Plan mode</span>
                <div className="h-px flex-1 bg-amber-300/40" />
              </div>
            );
          }
          if (group.kind === "notification") {
            const notifItem = group.items[0] as Extract<StreamItem, { kind: "notification" }>;
            return (
              <div key={gIdx} className="flex items-center justify-center gap-3 py-3 px-8">
                <div className="h-px flex-1 bg-[#007AFF]/20" />
                <span className="text-[12px] text-[#007AFF] font-medium whitespace-nowrap">{notifItem.subject}</span>
                <div className="h-px flex-1 bg-[#007AFF]/20" />
              </div>
            );
          }
          return (
            <div key={gIdx} className="space-y-1">
              {group.items.map((item, iIdx) => (
                <MessageBubble key={iIdx} item={item} group={group as Extract<MessageGroup, { items: StreamItem[] }>} index={iIdx} total={group.items.length} />
              ))}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input Form - Directly in the flow */}
      <form
        onSubmit={send}
        className="bg-white border-t border-black/[0.03]"
      >
        <div className="max-w-3xl mx-auto px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)] flex items-end gap-2">
        <div className="flex-1 relative flex items-end">
          <textarea 
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTranscribing ? "Transcribing..." : "iMessage"} 
            className="flex-1 min-h-[40px] max-h-[150px] bg-white border border-gray-200 rounded-[20px] pl-4 pr-10 py-2 text-[17px] outline-none resize-none focus:border-[#007AFF] transition-colors [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          />
          {!input.trim() && (
            <button
              type="button"
              onClick={startRecording}
              disabled={isTranscribing}
              className={`absolute right-2 bottom-1.5 w-7 h-7 flex items-center justify-center cursor-pointer transition-colors ${isRecording ? 'text-red-500' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRecording ? 'animate-pulse' : ''}>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <path d="M12 19v4"/>
                <path d="M8 23h8"/>
              </svg>
            </button>
          )}
        </div>
        
        {status === "thinking" ? (
          <button
            type="button"
            onClick={stopGeneration}
            title="Stop generating"
            className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center flex-shrink-0 active:scale-90 transition-all hover:bg-red-600 shadow-sm shadow-red-500/30"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="0" y="0" width="12" height="12" rx="2"/>
            </svg>
          </button>
        ) : input.trim() ? (
          <button
            type="submit"
            className="w-10 h-10 rounded-full bg-[#007AFF] text-white flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
        ) : null}
        </div>
      </form>
    </div>
  );
}
