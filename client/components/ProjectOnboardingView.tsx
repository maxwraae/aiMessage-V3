import { useState, useEffect, useRef } from "react";

type Props = {
  onComplete: (path: string) => void;
  onCancel: () => void;
};

export default function ProjectOnboardingView({ onComplete, onCancel }: Props) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const text = input.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    onComplete(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col h-full bg-white min-h-0">
      {/* Header */}
      <div className="h-20 lg:h-16 flex-shrink-0 border-b border-black/[0.05] flex items-center px-4 justify-between pt-6 lg:pt-0 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <button onClick={onCancel} className="flex items-center gap-1 text-[#3478F6] px-4 ml-[-16px] active:opacity-50 transition-opacity">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          <span className="text-[17px] font-medium">Cancel</span>
        </button>
        <div className="flex flex-col items-center flex-1 min-w-0 px-2">
          <span className="text-[13px] lg:text-[14px] font-bold text-gray-900 truncate">New Project</span>
        </div>
        <div className="min-w-[60px]" />
      </div>

      {/* Prompt */}
      <div className="flex-1 overflow-y-auto px-8 py-8 min-h-0 flex flex-col justify-center">
        <div className="flex flex-col items-start w-full">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">aiMessage</span>
          <p className="text-[18px] leading-relaxed text-gray-900 font-sans">Paste the project directory path.</p>
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 px-4 py-4 bg-white border-t border-black/[0.05]">
        <div className="flex items-center gap-2">
          <div className="flex-1 glass-input rounded-[22px] flex items-end bg-white border border-gray-200 py-1.5 px-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="/path/to/project"
              rows={1}
              disabled={submitting}
              className="flex-1 resize-none bg-transparent border-none text-[17px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 px-4 py-1"
            />
          </div>
          {input.trim() ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-10 h-10 rounded-full bg-[#007AFF] text-white flex items-center justify-center shadow-md shadow-[#007AFF]/20 active:scale-95 transition-transform"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
