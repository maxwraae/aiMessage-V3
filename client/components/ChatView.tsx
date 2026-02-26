import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamItem, ChatWsServerMessage, ChatWsClientMessage } from "../types/stream";

type AgentStatus = "idle" | "thinking" | "done" | "error" | "connecting" | "nudge";

type ToolCallItemProps = {
  item: Extract<StreamItem, { kind: "tool_call" }>;
  isTiled?: boolean;
};

function ToolCallItem({ item, isTiled }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full my-4">
      <div className="bg-gray-50/50 border border-black/[0.03] rounded-xl overflow-hidden shadow-sm">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] transition-colors group/tool"
        >
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-semibold text-gray-700 uppercase tracking-wide">
              {item.name}
            </span>
            <span className="text-[13px] text-gray-400 font-medium">
              {item.status === "running" ? "is running..." : item.status === "completed" ? "completed" : "failed"}
            </span>
          </div>
          <svg 
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" 
            className={`text-gray-300 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          >
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
        {expanded && (
          <div className="px-4 pb-4 space-y-3">
            <div className="pt-2 border-t border-black/[0.03]">
              <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-1.5">Input Parameters</div>
              <pre className="text-[12px] text-gray-600 font-mono bg-white/50 p-3 rounded-lg border border-black/[0.02] overflow-x-auto">
                {JSON.stringify(item.input, null, 2)}
              </pre>
            </div>
            {item.result !== undefined && (
              <div>
                <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-1.5">Execution Result</div>
                <pre className="text-[12px] text-gray-600 font-mono bg-white/50 p-3 rounded-lg border border-black/[0.02] overflow-x-auto max-h-60">
                  {typeof item.result === "string" ? item.result : JSON.stringify(item.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
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
    else if (item.kind === "error") kind = "error";

    if (item.kind === "assistant_message" || item.kind === "text_delta" || item.kind === "thought") kind = "agent";

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
  const [showReasoning, setShowReasoning] = useState(false);

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
    const isThought = item.kind === "thought";
    const text = (item as any).text || "";

    return (
      <div className="flex flex-col mb-8 items-start w-full">
        {index === 0 && (
          <div className="flex items-center gap-3 w-full mb-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Agent Response</span>
            {group.items.some(i => i.kind === "thought") && (
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="flex items-center gap-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest hover:text-gray-600 transition-colors"
              >
                <span className="opacity-50 text-[8px]">•</span>
                {showReasoning ? "Hide reasoning" : "Show reasoning"}
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className={`transition-transform duration-200 ${showReasoning ? "rotate-90" : ""}`}><path d="m9 18 6-6-6-6"/></svg>
              </button>
            )}
          </div>
        )}
        {isThought ? (
          showReasoning && (
            <div className="w-full mb-4 p-4 rounded-xl bg-gray-50/30 border border-black/[0.02] shadow-inner">
              <p className="text-[15px] leading-relaxed text-gray-500 italic font-sans">{text}</p>
            </div>
          )
        ) : (
          <div className="w-full">
            <p className="text-[18px] leading-relaxed text-gray-900 whitespace-pre-wrap break-words font-sans">{text}</p>
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "tool_call") return <ToolCallItem item={item} />;

  if (item.kind === "system") {
    return (
      <div className="flex justify-center my-6">
        <span className="text-[11px] text-gray-400 uppercase tracking-[0.2em] font-bold px-4 py-1.5 rounded-full bg-gray-50 border border-black/[0.03]">
          {item.text}
        </span>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="flex justify-center my-6 w-full">
        <div className="bg-red-50/50 border border-red-100 text-red-600 px-5 py-3 rounded-2xl text-[14px] font-medium max-w-md text-center shadow-sm">
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
  onModelSwitch?: (model: string) => void;
  currentModel?: string;
  isTiled?: boolean;
};

export default function ChatView({ agentId, onTitleUpdate, onUnreadReset, onModelSwitch, currentModel, isTiled }: Props) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("connecting");
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

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
          setStatus(msg.status as AgentStatus);
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
  }, [agentId, onTitleUpdate, onUnreadReset, upsertItem]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  function sendUserMessage() {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    // Maintain focus on mobile
    inputRef.current?.focus();

    const msg: ChatWsClientMessage = { type: "user_input", text };
    wsRef.current.send(JSON.stringify(msg));
    
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  async function startRecording() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone access is not supported in this browser or context (e.g. requires HTTPS).");
        return;
      }

      if (isRecording) {
        stopRecording();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      
      recorder.ondataavailable = (e) => { 
        if (e.data.size > 0) audioChunksRef.current.push(e.data); 
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setIsRecording(false);
        setIsTranscribing(true);
        if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);

        const formData = new FormData();
        formData.append("audio", audioBlob);
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: formData });
          const { text } = await res.json();
          if (text) setInput(prev => prev + (prev ? " " : "") + text);
        } catch (err) { 
          console.error("Transcription failed:", err); 
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecording(true);

      // 30s limit
      recordingTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          stopRecording();
        }
      }, 30000);

    } catch (err) { 
      console.error("Mic access denied:", err); 
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
  }

  const isThinking = status === "thinking";
  const canSend = input.trim().length > 0 && status !== "thinking" && status !== "connecting";
  const messageGroups = groupMessages(items);

  return (
    <div className="flex flex-col h-full bg-transparent min-h-0 relative">
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto ${isTiled ? "px-4" : "px-8"} pt-8 pb-32 space-y-6 min-h-0 touch-pan-y overscroll-contain relative z-10`} style={{ WebkitOverflowScrolling: "touch" }}>
        {messageGroups.length === 0 && status !== "connecting" && (
          <div className="flex flex-col items-center justify-center h-48 space-y-4 opacity-20 pointer-events-none">
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-white flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-white opacity-40 animate-pulse" />
            </div>
            <p className="text-sm font-medium tracking-wide uppercase">New Conversation</p>
          </div>
        )}
        {messageGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1">
            {group.items.map((item, iIdx) => (
              <MessageBubble key={item.id + iIdx} item={item} group={group} index={iIdx} total={group.items.length} />
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

      {/* Floating Search Dock Mirror */}
      <div className="px-6 pb-8 pt-2 lg:px-10 flex items-end gap-2 z-[100] relative">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            sendUserMessage();
          }}
          className="flex-1 min-h-[44px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)] rounded-[22px] border border-black/[0.03] flex items-center px-3 py-1.5"
        >
          <input 
            ref={inputRef}
            type="text"
            placeholder={isTranscribing ? "Transcribing..." : "iMessage"} 
            value={input}
            enterKeyHint="send"
            onChange={(e) => setInput(e.target.value)}
            disabled={isTranscribing}
            className={`bg-transparent border-none outline-none text-[17px] flex-1 text-gray-900 placeholder-gray-400 font-normal py-1 ${isTranscribing ? 'opacity-50' : ''}`} 
          />
          
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Microphone - only shows when empty */}
            {!input.trim() && (
              <button 
                type="button"
                onClick={(e) => { e.stopPropagation(); isRecording ? stopRecording() : startRecording(); }} 
                disabled={isTranscribing}
                className={`p-1 transition-all duration-300 cursor-pointer ${isRecording ? 'text-red-500 scale-110' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRecording ? 'animate-pulse' : ''}>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <path d="M12 19v4"/>
                  <path d="M8 23h8"/>
                </svg>
              </button>
            )}

            {/* Send Button - only shows when text exists */}
            {input.trim() && (
              <button 
                type="submit"
                className="w-8 h-8 rounded-full bg-[#007AFF] text-white flex items-center justify-center shadow-sm active:scale-90 transition-all flex-shrink-0 cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
