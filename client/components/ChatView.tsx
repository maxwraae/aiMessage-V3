import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamItem, ChatWsServerMessage, ChatWsClientMessage, ImageAttachment } from "../types/stream";

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

type PendingImage = ImageAttachment & { preview: string };

const TRACE_TOOLS = new Set([
  "Read", "Glob", "Grep", "ToolSearch", "TaskOutput",
  "WebSearch", "WebFetch", "ListMcpResourcesTool", "ReadMcpResourceTool",
  "TaskList", "TaskGet", "WebSearch"
]);

const DESTRUCTIVE_BASH_PATTERNS = [
  /\brm\b/, /\bmv\b/, /\bgit\s+push\b/, /\bgit\s+reset\b/,
  /\bchmod\b/, /\bnpm\s+publish\b/, /\bdocker\b/, /\bkill\b/,
  />>?/, /\btee\b/
];

function classifyTool(name: string, input: unknown): "trace" | "promoted" {
  if (["Edit", "Write", "NotebookEdit"].includes(name)) return "promoted";
  if (name === "Agent" || name === "TaskCreate" || name === "TaskUpdate") return "promoted";
  if (TRACE_TOOLS.has(name)) return "trace";
  if (name === "Bash") {
    const cmd = typeof input === "object" && input !== null && "command" in input
      ? String((input as any).command)
      : "";
    if (DESTRUCTIVE_BASH_PATTERNS.some(p => p.test(cmd))) return "promoted";
    return "trace";
  }
  // MCP tools that create/send/delete are promoted
  if (/^mcp__/.test(name) && /(create|send|delete|update|modify|manage|write|set|remove)/.test(name)) {
    return "promoted";
  }
  return "trace";
}

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
      (currentGroup.kind === kind && (kind === "user" || kind === "agent" || kind === "tool"));

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

function ToolPillIcon({ type, pulse }: { type: 'batch' | 'edit' | 'agent' | 'bash' | 'mcp'; pulse?: boolean }) {
  const cls = `w-3.5 h-3.5 ${pulse ? 'animate-pulse' : ''}`;
  switch (type) {
    case 'batch':
      return <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /></svg>;
    case 'edit':
      return <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" /></svg>;
    case 'agent':
      return <svg className={cls} viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l8 5-8 5V3z" /></svg>;
    case 'bash':
      return <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4l4 4-4 4M9 12h4" /></svg>;
    case 'mcp':
      return <svg className={cls} viewBox="0 0 16 16" fill="currentColor"><path d="M9 1L4 9h4l-1 6 5-8H8l1-6z" /></svg>;
  }
}

function getPillType(toolName: string): 'batch' | 'edit' | 'agent' | 'bash' | 'mcp' {
  if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) return 'edit';
  if (['Agent', 'TaskCreate', 'TaskUpdate'].includes(toolName)) return 'agent';
  if (toolName === 'Bash') return 'bash';
  if (toolName.startsWith('mcp_') || toolName.startsWith('mcp__')) return 'mcp';
  return 'batch';
}

function TracePill({ items }: { items: Extract<StreamItem, { kind: "tool_call" }>[] }) {
  const [expanded, setExpanded] = useState(false);
  const running = items.filter(i => i.status === "running");
  const isRunning = running.length > 0;

  // Build smart summary grouped by tool type with detail extraction
  type TraceGroup = { label: string; details: string[] };
  const groups: Record<string, TraceGroup> = {};

  for (const item of items) {
    let label: string;
    let detail: string;
    const inp = item.input as Record<string, any> | null;

    if (item.name === "Read" && inp?.file_path) {
      label = "read";
      detail = String(inp.file_path).split("/").pop() || "file";
    } else if (item.name === "Grep" && inp?.pattern) {
      label = "search";
      detail = `"${inp.pattern}"`;
    } else if (item.name === "Glob" && inp?.pattern) {
      label = "glob";
      detail = inp.pattern;
    } else if (item.name === "WebSearch" && inp?.query) {
      label = "search";
      detail = `"${String(inp.query).substring(0, 30)}"`;
    } else if (item.name === "WebFetch" && inp?.url) {
      label = "fetch";
      try { detail = new URL(String(inp.url)).hostname; } catch { detail = "url"; }
    } else if (item.name === "Bash" && inp?.command) {
      label = "bash";
      const cmd = String(inp.command);
      detail = cmd.length > 30 ? cmd.substring(0, 27) + "..." : cmd;
    } else {
      label = item.name.toLowerCase();
      detail = "";
    }

    if (!groups[label]) groups[label] = { label, details: [] };
    groups[label].details.push(detail);
  }

  const summary = Object.values(groups).map(g => {
    const first = g.details[0];
    const rest = g.details.length - 1;
    const base = first ? `${g.label} ${first}` : g.label;
    return rest > 0 ? `${base} +${rest}` : base;
  }).join(" · ");

  // Running state: show detail of the first running item
  let runningText = "";
  if (isRunning) {
    const r = running[0];
    const inp = r.input as Record<string, any> | null;
    let detail = "";
    if (r.name === "Read" && inp?.file_path) {
      detail = " " + (String(inp.file_path).split("/").pop() || "");
    } else if (r.name === "Grep" && inp?.pattern) {
      detail = ` "${inp.pattern}"`;
    } else if (r.name === "Glob" && inp?.pattern) {
      detail = " " + inp.pattern;
    } else if (r.name === "WebSearch" && inp?.query) {
      detail = ` "${String(inp.query).substring(0, 20)}"`;
    }
    const base = r.name.toLowerCase();
    const gerund = base.endsWith("e") ? base.slice(0, -1) + "ing" : base + "ing";
    runningText = gerund + detail + "...";
  }

  return (
    <div className={expanded ? "w-full" : ""}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="inline-flex items-center gap-1.5 h-7 rounded-full bg-gray-100 px-3 py-1 cursor-pointer"
      >
        <ToolPillIcon type="batch" pulse={isRunning} />
        <span className="text-[12px] text-gray-500 font-medium">
          {isRunning ? runningText : summary}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 rounded-lg border border-black/[0.04] overflow-hidden w-full">
          {items.map((item, i) => (
            <div key={item.id || i} className="flex items-center gap-3 px-3 py-1 text-[11px] border-b border-black/[0.02] last:border-b-0">
              <span className="text-gray-400 font-medium w-12 flex-shrink-0">{item.name}</span>
              <span className="text-gray-300 truncate flex-1 font-mono">
                {item.name === "Read" && typeof item.input === "object" && item.input !== null && "file_path" in item.input
                  ? String((item.input as any).file_path).split("/").pop()
                  : item.name === "Grep" && typeof item.input === "object" && item.input !== null && "pattern" in item.input
                  ? `"${(item.input as any).pattern}"`
                  : item.name === "Glob" && typeof item.input === "object" && item.input !== null && "pattern" in item.input
                  ? (item.input as any).pattern
                  : ""}
              </span>
              <span className={`text-[10px] flex-shrink-0 ${item.status === "running" ? "text-amber-400" : item.status === "failed" ? "text-red-400" : "text-gray-300"}`}>
                {item.status === "running" ? "..." : item.status === "failed" ? "failed" : "done"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromotedPill({ item }: { item: Extract<StreamItem, { kind: "tool_call" }> }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = item.status === "running";
  const pillType = getPillType(item.name);

  // Build summary text
  let summary = item.name.replace(/_/g, " ");
  if (item.name === "Edit" && typeof item.input === "object" && item.input !== null && "file_path" in item.input) {
    const file = String((item.input as any).file_path).split("/").pop();
    summary = `Edited ${file}`;
  } else if (item.name === "Write" && typeof item.input === "object" && item.input !== null && "file_path" in item.input) {
    const file = String((item.input as any).file_path).split("/").pop();
    summary = `Wrote ${file}`;
  } else if (item.name === "Bash" && typeof item.input === "object" && item.input !== null && "command" in item.input) {
    const cmd = String((item.input as any).command);
    summary = cmd.length > 50 ? cmd.substring(0, 47) + "..." : cmd;
  } else if (item.name === "Agent" && typeof item.input === "object" && item.input !== null && "description" in item.input) {
    summary = `Agent: ${(item.input as any).description}`;
  } else if (/^mcp__/.test(item.name)) {
    summary = item.name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
  }

  return (
    <div className={expanded ? "w-full" : ""}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="inline-flex items-center gap-1.5 h-7 rounded-full bg-gray-100 px-3 py-1 cursor-pointer"
      >
        <ToolPillIcon type={pillType} pulse={isRunning} />
        <span className="text-[12px] text-gray-500 font-medium truncate max-w-[300px]">
          {summary}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 px-3 pb-2 space-y-2 w-full">
          <div className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Input</div>
          <pre className="text-[11px] text-gray-600 font-mono bg-gray-50 p-2 rounded border border-black/[0.02] overflow-x-auto">
            {JSON.stringify(item.input, null, 2)}
          </pre>
          {item.result !== undefined && (
            <>
              <div className="text-[9px] font-bold text-gray-300 uppercase tracking-widest mt-2">Result</div>
              <pre className="text-[11px] text-gray-600 font-mono bg-gray-50 p-2 rounded border border-black/[0.02] overflow-x-auto max-h-40 overflow-y-auto">
                {typeof item.result === "string" ? item.result : JSON.stringify(item.result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative bg-gray-50 rounded-lg border border-black/[0.04] my-3 group/code">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        {language && (
          <span className="text-[11px] text-gray-400 lowercase">{language}</span>
        )}
        {!language && <span />}
        <button
          onClick={handleCopy}
          className="text-[11px] text-gray-300 hover:text-gray-500 opacity-0 group-hover/code:opacity-100 transition-opacity"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="px-3 pb-3 overflow-x-auto max-h-[400px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <code className="text-[13px] leading-[1.5] font-mono text-gray-800">{children}</code>
      </pre>
    </div>
  );
}

function MessageBubble({ item, group, index, total }: { item: StreamItem; group: Extract<MessageGroup, { items: StreamItem[] }>; index: number; total: number }) {
  if (group.kind === "user") {
    const text = (item as any).text || "";

    return (
      <div className="flex justify-start">
        <div className="bg-gray-100 rounded-lg px-4 py-2 max-w-2xl">
          <p className="text-[15px] leading-[1.5] text-gray-900 font-normal whitespace-pre-wrap break-words font-sans antialiased">{text}</p>
        </div>
      </div>
    );
  }

  if (group.kind === "agent") {
    const text = (item as any).text || "";

    return (
      <div className="flex flex-col items-start w-full">
        <div className="w-full max-w-full overflow-x-hidden">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            className="text-[15px] leading-[1.7] text-gray-900 font-sans antialiased max-w-2xl"
            components={{
              p: ({children}) => <p className="mb-3 last:mb-0">{children}</p>,
              ul: ({children}) => <ul className="list-disc pl-6 mb-3">{children}</ul>,
              ol: ({children}) => <ol className="list-decimal pl-6 mb-3">{children}</ol>,
              li: ({children}) => <li className="mb-1">{children}</li>,
              pre: ({children}) => {
                const child = children as any;
                if (child?.type === 'code') {
                  const className = child.props?.className || '';
                  const lang = className.replace(/^language-/, '');
                  const text = typeof child.props?.children === 'string'
                    ? child.props.children
                    : Array.isArray(child.props?.children)
                      ? child.props.children.map(String).join('')
                      : String(child.props?.children || '');
                  return <CodeBlock language={lang}>{text}</CodeBlock>;
                }
                return <pre>{children}</pre>;
              },
              code: ({node, className, children, ...props}) => {
                // If inside a pre block, ReactMarkdown handles it via the pre component above
                // This only handles inline code
                return <code className="bg-gray-100 px-1 rounded text-[13px] leading-[1.4] text-gray-800 font-mono" {...props}>{children}</code>;
              },
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
  const [debugMode, setDebugMode] = useState<boolean>(() => {
    try { return localStorage.getItem("aimessage-debug-mode") === "true"; } catch { return false; }
  });
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Text buffering for phrase-cluster streaming
  const textBufferRef = useRef<string>("");
  const flushTimerRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist debug mode and handle Cmd+Shift+D toggle
  useEffect(() => {
    try { localStorage.setItem("aimessage-debug-mode", String(debugMode)); } catch { /* ignore */ }
  }, [debugMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setDebugMode(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
          // Deduplicate tool_calls by ID — keep the last occurrence
          // (server writes 'running' then 'completed' for each tool call)
          const seenToolIds = new Set<string>();
          const deduped: typeof msg.items = [];
          for (let i = msg.items.length - 1; i >= 0; i--) {
            const item = msg.items[i];
            if (item.kind === "tool_call" && item.id) {
              if (seenToolIds.has(item.id)) continue; // skip earlier duplicate
              seenToolIds.add(item.id);
            }
            deduped.unshift(item);
          }
          console.log(`[WS] After dedup: ${deduped.length} items`);
          setItems(deduped);
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

  // Upload a File object to /api/upload and return a PendingImage
  const uploadFile = useCallback(async (file: File): Promise<PendingImage | null> => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { base64, mediaType, filename } = await res.json() as { base64: string; mediaType: string; filename: string };
      const preview = `data:${mediaType};base64,${base64}`;
      return { base64, mediaType, filename, preview };
    } catch (err) {
      console.error("Image upload failed:", err);
      return null;
    }
  }, []);

  // Handle files selected via the hidden file input
  const handleFilesSelected = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const uploads = await Promise.all(fileArray.map(uploadFile));
    const valid = uploads.filter((u): u is PendingImage => u !== null);
    if (valid.length > 0) {
      setPendingImages(prev => [...prev, ...valid]);
    }
    // Reset the file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelected(e.target.files);
    }
  }, [handleFilesSelected]);

  // Handle paste events on the textarea
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    handleFilesSelected(imageFiles);
  }, [handleFilesSelected]);

  // Drag-and-drop handlers on the whole chat area
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the outermost container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      handleFilesSelected(imageFiles);
    }
  }, [handleFilesSelected]);

  const removePendingImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const send = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = input.trim();
    const hasImages = pendingImages.length > 0;

    // Allow sending with just images, but require at least text or images
    if ((!text && !hasImages) || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog("SEND BLOCKED");
      return;
    }

    addLog("SENDING...");
    const msg: ChatWsClientMessage = {
      type: "user_input",
      text,
      ...(hasImages ? { images: pendingImages.map(({ base64, mediaType, filename }) => ({ base64, mediaType, filename })) } : {})
    };
    wsRef.current.send(JSON.stringify(msg));
    setInput("");
    setPendingImages([]);
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
    <div
      className={`flex flex-col h-full relative overflow-hidden transition-all ${status === "thinking" ? "thinking-canvas" : "idle-canvas"} ${isDragOver ? "ring-2 ring-inset ring-[#007AFF]/40 bg-[#007AFF]/[0.02]" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-over overlay hint */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white/90 backdrop-blur-sm border border-[#007AFF]/30 rounded-2xl px-8 py-5 shadow-lg">
            <p className="text-[#007AFF] text-[15px] font-medium">Drop image to attach</p>
          </div>
        </div>
      )}

      {/* Debug toggle button — subtle, always visible */}
      <button
        onClick={() => setDebugMode(prev => !prev)}
        title={debugMode ? "Hide system log (⌘⇧D)" : "Show system log (⌘⇧D)"}
        className={`absolute top-3 right-3 w-6 h-6 rounded-md flex items-center justify-center z-50 transition-colors ${debugMode ? "bg-green-500/20 text-green-600" : "text-gray-200 hover:text-gray-400"}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <path d="M12 17h.01"/>
        </svg>
      </button>

      {/* Internal Log Overlay (Diagnostic Eyes) — only shown in debug mode */}
      {debugMode && (
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
      )}


      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-6 pb-32 touch-pan-y overscroll-contain"
      >
        <div className="max-w-[720px] mx-auto w-full px-6">
        {messageGroups.map((group, gIdx) => {
          // Calculate vertical spacing based on group transitions
          const prevGroup = gIdx > 0 ? messageGroups[gIdx - 1] : null;
          let topMargin = "";
          if (prevGroup) {
            const prevKind = prevGroup.kind;
            const currKind = group.kind;
            if (prevKind === "context_clear" || prevKind === "plan_mode" || prevKind === "notification") {
              topMargin = ""; // these have their own padding
            } else if (prevKind === currKind && (currKind === "user" || currKind === "agent")) {
              topMargin = "mt-1"; // same sender consecutive: 4px
            } else if ((prevKind === "user" && currKind === "agent") || (prevKind === "agent" && currKind === "user")) {
              topMargin = "mt-6"; // sender switch: 24px
            } else if ((prevKind === "agent" && currKind === "tool") || (prevKind === "tool" && currKind === "agent")) {
              topMargin = "mt-2"; // agent ↔ tool: 8px
            } else if (prevKind === "user" && currKind === "tool") {
              topMargin = "mt-4"; // user → tool: 16px
            } else if (prevKind === "tool" && currKind === "user") {
              topMargin = "mt-6"; // tool → user: 24px
            } else {
              topMargin = "mt-4"; // default fallback: 16px
            }
          }

          if (group.kind === "context_clear") {
            return (
              <div key={group.id} className={`flex items-center gap-3 py-4 px-2 ${topMargin}`}>
                <div className="h-px flex-1 bg-black/10" />
                <span className="text-[11px] text-gray-400 font-medium whitespace-nowrap tracking-wide">Context cleared</span>
                <div className="h-px flex-1 bg-black/10" />
              </div>
            );
          }
          if (group.kind === "plan_mode") {
            return (
              <div key={group.id} className={`flex items-center gap-3 py-4 px-2 ${topMargin}`}>
                <div className="h-px flex-1 bg-amber-300/40" />
                <span className="text-[11px] text-amber-600/70 font-medium whitespace-nowrap tracking-wide">Plan mode</span>
                <div className="h-px flex-1 bg-amber-300/40" />
              </div>
            );
          }
          if (group.kind === "notification") {
            const notifItem = group.items[0] as Extract<StreamItem, { kind: "notification" }>;
            return (
              <div key={gIdx} className={`flex items-center justify-center gap-3 py-3 px-8 ${topMargin}`}>
                <div className="h-px flex-1 bg-[#007AFF]/20" />
                <span className="text-[12px] text-[#007AFF] font-medium whitespace-nowrap">{notifItem.subject}</span>
                <div className="h-px flex-1 bg-[#007AFF]/20" />
              </div>
            );
          }
          if (group.kind === "tool") {
            // Standalone tool groups (e.g. right after a user message with no preceding agent text)
            const toolItems = group.items as Extract<StreamItem, { kind: "tool_call" }>[];
            const traceItems = toolItems.filter(i => classifyTool(i.name, i.input) === "trace");
            const promotedItems = toolItems.filter(i => classifyTool(i.name, i.input) === "promoted");

            return (
              <div key={gIdx} className={`flex flex-wrap items-start gap-1.5 ${topMargin}`}>
                {traceItems.length > 0 && <TracePill items={traceItems} />}
                {promotedItems.map((item, iIdx) => (
                  <PromotedPill key={item.id || iIdx} item={item} />
                ))}
              </div>
            );
          }
          return (
            <div key={gIdx} className={topMargin}>
              {group.items.map((item, iIdx) => {
                // tool_call items now always belong to their own "tool" group; skip any
                // that might appear here due to stale data to prevent double-rendering.
                if (item.kind === "tool_call") return null;

                return (
                  <MessageBubble key={iIdx} item={item} group={group as Extract<MessageGroup, { items: StreamItem[] }>} index={iIdx} total={group.items.length} />
                );
              })}
            </div>
          );
        })}
        <div ref={bottomRef} />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Input Form - Glass container floating over content */}
      <form
        onSubmit={send}
        className="absolute bottom-0 left-0 right-0 z-10"
      >
        <div className="max-w-[720px] mx-auto px-4 mb-3">
          <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.06)] p-3">
            {/* Pending image thumbnails strip */}
            {pendingImages.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {pendingImages.map((img, idx) => (
                    <div key={idx} className="relative group/thumb flex-shrink-0">
                      <img
                        src={img.preview}
                        alt={img.filename || `Image ${idx + 1}`}
                        className="w-12 h-12 object-cover rounded-lg border border-black/[0.06] shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removePendingImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-600/80 text-white rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-gray-800"
                        title="Remove image"
                      >
                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M1 1l10 10M11 1L1 11"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isTranscribing ? "Transcribing..." : "Message"}
              className="w-full min-h-[36px] max-h-[150px] bg-transparent border-none pl-1 pr-1 py-1 text-[15px] outline-none resize-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            />

            {/* Action pills row */}
            <div className="flex items-center gap-2 mt-1">
              {/* Attach button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
                className="w-8 h-8 rounded-full bg-gray-100/60 text-gray-400 flex items-center justify-center flex-shrink-0 hover:text-[#007AFF] hover:bg-gray-100 active:scale-90 transition-all"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </button>

              {/* Mic button */}
              <button
                type="button"
                onClick={startRecording}
                disabled={isTranscribing}
                className={`w-8 h-8 rounded-full bg-gray-100/60 flex items-center justify-center flex-shrink-0 active:scale-90 transition-all ${isRecording ? 'text-red-500 bg-red-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRecording ? 'animate-pulse' : ''}>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <path d="M12 19v4"/>
                  <path d="M8 23h8"/>
                </svg>
              </button>

              <div className="flex-1" />

              {/* Send / Stop button */}
              {status === "thinking" ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  title="Stop generating"
                  className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center flex-shrink-0 active:scale-90 transition-all hover:bg-red-600 shadow-sm shadow-red-500/30"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                    <rect x="0" y="0" width="12" height="12" rx="2"/>
                  </svg>
                </button>
              ) : (input.trim() || pendingImages.length > 0) ? (
                <button
                  type="submit"
                  className="w-8 h-8 rounded-full bg-[#007AFF] text-white flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
