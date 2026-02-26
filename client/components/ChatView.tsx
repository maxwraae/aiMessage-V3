import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamItem, ChatWsServerMessage, ChatWsClientMessage } from "../types/stream";

type AgentStatus = "idle" | "thinking" | "done" | "error" | "connecting" | "nudge";

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
          <p className="text-[17px] leading-snug whitespace-pre-wrap break-words font-sans">{text}</p>
        </div>
      </div>
    );
  }

  if (group.kind === "agent") {
    const isThought = item.kind === "thought";
    const text = (item as any).text || "";

    if (isThought) return null; // Keep it simple for now

    return (
      <div className="flex flex-col mb-4 items-start w-full px-1">
        {index === 0 && (
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">Agent</div>
        )}
        <p className="text-[17px] leading-relaxed text-gray-900 whitespace-pre-wrap break-words font-sans">{text}</p>
      </div>
    );
  }

  return null;
}

export default function ChatView({ agentId }: { agentId: string }) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("connecting");
  const [input, setInput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-3), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  async function startRecording() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone access is not supported.");
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
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [items]);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws/chat/${agentId}`);
    wsRef.current = ws;

    ws.onopen = () => { setStatus("idle"); addLog("CONNECTED"); };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as ChatWsServerMessage;
        if (msg.type === "history_snapshot") setItems(msg.items);
        else if (msg.type === "stream_item") setItems(prev => [...prev, msg.item]);
        else if (msg.type === "agent_status") setStatus(msg.status as AgentStatus);
      } catch { /* ignore */ }
    };
    ws.onclose = () => { setStatus("error"); addLog("CLOSED"); };

    return () => {
      ws.close();
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    };
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
      {/* Mini Debug Header */}
      <div className="px-4 py-1 bg-gray-50 text-[10px] text-gray-400 border-b flex justify-between items-center">
        <span>{status} | {agentId}</span>
        <span>{logs[logs.length-1]}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 touch-pan-y overscroll-contain">
        {messageGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1">
            {group.items.map((item, iIdx) => (
              <MessageBubble key={iIdx} item={item} group={group} index={iIdx} total={group.items.length} />
            ))}
          </div>
        ))}
        {status === "thinking" && (
          <div className="flex gap-1 ml-2 py-2">
            <span className="w-1 h-1 rounded-full bg-gray-300 animate-bounce" />
            <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" />
            <span className="w-1 h-1 rounded-full bg-gray-300 animate-bounce" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Form - Directly in the flow */}
      <form 
        onSubmit={send}
        className="px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)] flex items-end gap-2 bg-white border-t border-black/[0.03]"
      >
        <div className="flex-1 relative flex items-end">
          <textarea 
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTranscribing ? "Transcribing..." : "iMessage"} 
            className="flex-1 min-h-[40px] max-h-[150px] bg-white border border-gray-200 rounded-[20px] pl-4 pr-10 py-2 text-[17px] outline-none resize-none focus:border-[#007AFF] transition-colors"
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
        
        {input.trim() && (
          <button
            type="submit"
            className="w-10 h-10 rounded-full bg-[#007AFF] text-white flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
        )}
      </form>
    </div>
  );
}
