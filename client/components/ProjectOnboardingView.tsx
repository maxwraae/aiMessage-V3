import { useState, useEffect, useRef } from "react";

type Step = "name" | "path" | "model" | "creating";

type Message = {
  role: "system" | "user";
  text: string;
};

type Props = {
  onComplete: (name: string, path?: string, model?: string) => void;
  onCancel: () => void;
};

export default function ProjectOnboardingView({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("name");
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", text: "Let's build something new. What's the name of your project?" }
  ]);
  const [input, setInput] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit() {
    const text = input.trim();
    if (!text && step === "name") return;

    if (step === "name") {
      setProjectName(text);
      setMessages(prev => [
        ...prev, 
        { role: "user", text },
        { role: "system", text: `Got it: "${text}". Where should I put it? (Press Enter for default ~/projects/)` }
      ]);
      setStep("path");
      setInput("");
    } else if (step === "path") {
      const customPath = text || undefined;
      setProjectPath(customPath);
      setMessages(prev => [
        ...prev, 
        { role: "user", text: text || "Default (~/projects/)" },
        { role: "system", text: "Which model should we use? (sonnet, haiku, or opus)" }
      ]);
      setStep("model");
      setInput("");
    } else if (step === "model") {
      const model = text.toLowerCase() || "sonnet";
      setMessages(prev => [
        ...prev, 
        { role: "user", text: model },
        { role: "system", text: `Perfect. Initializing your project with Claude 3.5 ${model} now...` }
      ]);
      setStep("creating");
      setTimeout(() => onComplete(projectName, projectPath, model), 1000);
    }
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
          <span className="text-[13px] lg:text-[14px] font-bold text-gray-900 truncate">New Project Setup</span>
        </div>
        <div className="min-w-[60px]" />
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6 min-h-0">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'flex-col mb-8 items-start w-full'}`}>
            {msg.role === 'system' ? (
              <div className="flex flex-col items-start w-full">
                <div className="flex items-center gap-3 w-full mb-2">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">aiMessage</span>
                </div>
                <p className="text-[18px] leading-relaxed text-gray-900 font-sans">{msg.text}</p>
              </div>
            ) : (
              <div className="glass-bubble-user text-white px-4 py-2 shadow-sm bubble-user-single bubble-tail max-w-[75%]">
                <p className="text-[17px] leading-snug font-sans">{msg.text}</p>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
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
              placeholder={
                step === "name" ? "Project Name" : 
                step === "path" ? "Custom Path (optional)" :
                "Model (sonnet, haiku, opus)"
              }
              rows={1}
              disabled={step === "creating"}
              className="flex-1 resize-none bg-transparent border-none text-[17px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 px-4 py-1"
            />
          </div>
          {input.trim() || step === "path" || step === "model" ? (
            <button
              onClick={handleSubmit}
              disabled={step === "creating"}
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
