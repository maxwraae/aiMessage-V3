import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import ChatView from "./components/ChatView";
import ProjectOnboardingView from "./components/ProjectOnboardingView";

type Project = {
  key: string;
  path: string;
  name: string;
  lastActivity: string;
  sessionCount: number;
};

type ChatAgentData = {
  id: string;
  type: "chat";
  title: string;
  projectPath: string;
  model?: string;
  sessionId?: string;
  status: "running" | "stopped";
  agentStatus: "idle" | "thinking" | "done" | "error";
  unreadCount: number;
  startedAt: string;
};

type Session = {
  id: string;
  title: string | null;
  preview: string | null;
  created: string;
  modified: string;
  status: "running" | "stopped";
  agentId?: string;
  agentStatus?: "idle" | "thinking" | "done" | "error" | "nudge";
  unreadCount: number;
  hasUnread?: boolean;
  latestNotification?: string | null;
};

function SessionAvatar({ session, initials, liveStatus }: { session: Session; initials: string; liveStatus?: string }) {
  const isThinking = (liveStatus || session.agentStatus) === "thinking";
  const isWarm = session.status === "running";
  const hasNotification = !!session.latestNotification;
  const hasUnread = session.hasUnread;

  return (
    <div className="relative flex-shrink-0 mr-3">
      {/* Notification Ring */}
      {hasNotification && (
        <div className="absolute -inset-1 rounded-full border-2 border-[#007AFF] animate-pulse" />
      )}

      {/* The Avatar */}
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] lg:text-[11px] font-bold transition-all duration-500 ${
        hasUnread
          ? 'bg-[#007AFF] text-white shadow-sm shadow-[#007AFF]/30'
          : isThinking
            ? `bg-blue-50 text-[#007AFF] shadow-sm breathing-glow-ring`
            : isWarm
              ? 'bg-blue-50 text-[#007AFF] shadow-sm'
              : 'bg-gray-100/50 text-gray-400'
      }`}>
        {initials}
      </div>
    </div>
  );
}

export default function App() {
  console.log("[App] Rendering...");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<ChatAgentData[]>([]);
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [onboardingProject, setOnboardingProject] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewStack, setViewStack] = useState<string[]>(["projects"]); // 'projects' | 'messages' | 'chat'
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects).catch(() => {});
    fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {});

    pollRef.current = setInterval(() => {
      // Poll active agents to keep global state fresh
      fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {});
      
      // If we have a project open, refresh its sessions
      if (selectedProject) {
        fetch(`/api/projects/${encodeURIComponent(selectedProject.key)}/sessions`)
          .then((r) => r.json())
          .then(setSessions)
          .catch(() => {});
      }
    }, 10000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedProject]);

  function openProject(project: Project) {
    setSelectedProject(project);
    setSessions([]);
    fetch(`/api/projects/${encodeURIComponent(project.key)}/sessions`)
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => {});
    
    setViewStack(["projects", "messages"]);
  }

  function goBack() {
    setOnboardingProject(false);
    setViewStack((prev) => {
      const next = [...prev];
      if (next.length > 1) {
        next.pop();
        if (next[next.length - 1] === "projects") {
          setSelectedProject(null);
          // Don't clear active agents, they stay running
        }
        return next;
      }
      return prev;
    });
  }

  const startAgent = useCallback(async (resumeSessionId?: string, split: boolean = false, explicitPath?: string, model?: string) => {
    let targetProject = selectedProject;
    
    const projectPath = explicitPath || targetProject?.path || "~";


    setSpawning(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath,
          type: "chat",
          resumeSessionId,
          model,
        }),
      });
      const agent: ChatAgentData = await res.json();
      
      setAgents((prev) => {
        const existing = prev.find(a => a.id === agent.id);
        if (existing) return prev;
        return [...prev, agent];
      });
      
      if (split && activeAgentIds.length < 4) {
        if (!activeAgentIds.includes(agent.id)) {
          setActiveAgentIds(prev => [...prev, agent.id]);
        }
      } else {
        setActiveAgentIds([agent.id]);
      }

      // Refresh sessions immediately to show "Warm" state
      if (selectedProject) {
        fetch(`/api/projects/${encodeURIComponent(selectedProject.key)}/sessions`)
          .then((r) => r.json())
          .then(setSessions);
      }

      setViewStack(["projects", "messages", "chat"]);
    } catch {
      // ignore
    } finally {
      setSpawning(false);
    }
  }, [selectedProject, projects, activeAgentIds.length]);

  const killAgent = useCallback(async (agent: ChatAgentData) => {
    await fetch(`/api/agents/${agent.id}`, { method: "DELETE" }).catch(() => {});
    setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    setActiveAgentIds((prev) => prev.filter((id) => id !== agent.id));
  }, []);

  const stopAgent = useCallback(async (agentId: string) => {
    await fetch(`/api/agents/${agentId}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const switchAgentModel = useCallback(async (agentId: string, model: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    // 1. Kill the old one
    await fetch(`/api/agents/${agent.id}`, { method: "DELETE" }).catch(() => {});
    
    // 2. Spawn a new one with same sessionId and new model
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: agent.projectPath,
          resumeSessionId: agent.id,
          model,
        }),
      });
      const newAgent: ChatAgentData = await res.json();
      
      setAgents((prev) => prev.map(a => a.id === agentId ? newAgent : a));
      setActiveAgentIds((prev) => prev.map(id => id === agentId ? newAgent.id : id));
    } catch (err) {
      alert("Failed to switch model");
    }
  }, [agents]);

  const handleRenameProject = async (project: Project) => {
    const alias = prompt("Enter new project name:", project.name);
    if (alias === null) return;
    
    try {
      await fetch(`/api/projects/${encodeURIComponent(project.key)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias }),
      });
      setProjects((prev) => prev.map((p) => p.key === project.key ? { ...p, name: alias } : p));
    } catch (err) {
      alert("Failed to rename project");
    }
  };

  const handleRenameSession = async (session: Session) => {
    const alias = prompt("Enter new session name:", session.title || "");
    if (alias === null) return;
    
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias }),
      });
      setSessions((prev) => prev.map((s) => s.id === session.id ? { ...s, title: alias } : s));
    } catch (err) {
      alert("Failed to rename session");
    }
  };

  const handleCreateProject = async () => {
    setOnboardingProject(true);
    setViewStack(["projects", "messages", "chat"]);
  };

  const completeOnboarding = async (dirPath: string) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath }),
      });
      const { agent } = await res.json();

      const projectsRes = await fetch("/api/projects");
      const newProjects = await projectsRes.json();
      setProjects(newProjects);

      setAgents((prev) => [...prev, agent]);
      setActiveAgentIds([agent.id]);
      setOnboardingProject(false);
      setViewStack(["projects", "messages", "chat"]);
    } catch (err) {
      alert("Failed to create project");
      setOnboardingProject(false);
    }
  };

  const toggleAgentOnStage = (agentId: string, split: boolean = false) => {
    setOnboardingProject(false);
    if (split) {
      if (activeAgentIds.includes(agentId)) return;
      if (activeAgentIds.length < 4) {
        setActiveAgentIds(prev => [...prev, agentId]);
      }
    } else {
      setActiveAgentIds([agentId]);
    }

    setViewStack(["projects", "messages", "chat"]);
  };

  const removeFromStage = (agentId: string) => {
    setActiveAgentIds(prev => prev.filter(id => id !== agentId));
  };

  const projectAgents = useMemo(() => 
    selectedProject ? agents.filter((a) => a.projectPath === selectedProject.path && a.status === "running") : []
  , [agents, selectedProject]);

  const handleTitleUpdate = useCallback((agentId: string, newTitle: string) => {
    setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, title: newTitle } : a));
  }, []);

  const handleUnreadReset = useCallback((agentId: string) => {
    setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, unreadCount: 0 } : a));
  }, []);

  const handleStatusChange = useCallback((sessionId: string, status: string) => {
    console.log(`[Glow] ${sessionId} → ${status} (breathing=${status === "thinking"})`);
    setAgentStatuses((prev) => ({ ...prev, [sessionId]: status }));
  }, []);

  const activeAgentCount = (p: Project) =>
    agents.filter((a) => a.projectPath === p.path && a.status === "running").length;

  const unreadTotal = useMemo(() => agents.reduce((acc, a) => acc + a.unreadCount, 0), [agents]);

  const getGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1 grid-rows-1";
    if (count === 2) return "grid-cols-1 lg:grid-cols-2 lg:grid-rows-1";
    return "grid-cols-1 lg:grid-cols-2 lg:grid-rows-2";
  };

  const currentScene = viewStack[viewStack.length - 1];

  return (
    <div className="fixed inset-0 flex bg-white text-gray-900 overflow-hidden font-sans">
      {/* Sidebar / Navigation Layer */}
      <div className={`
        flex-shrink-0 w-full lg:w-[320px] border-r border-black/[0.05] flex flex-col z-10 bg-white relative
        ${currentScene === 'chat' ? 'hidden lg:flex' : 'flex'}
      `}>
        
        {/* Navigation Header */}
        <div className="pt-12 lg:pt-8 px-6 pb-2 flex flex-col items-start gap-0.5">
          {viewStack.length === 1 && (
            <div className="flex items-center justify-between w-full pr-2">
              <h1 className="text-[28px] lg:text-[20px] font-bold tracking-tight text-gray-900 px-1">Projects</h1>
              <button 
                onClick={(e) => { e.stopPropagation(); handleCreateProject(); }}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#3478F6] hover:bg-black/[0.05] active:scale-95 transition-all"
                title="New Project"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </button>
            </div>
          )}
          {viewStack.length > 1 && (
            <>
              <h1 className="text-[28px] lg:text-[20px] font-bold tracking-tight text-gray-900 px-1">Messages</h1>
              <button
                onClick={goBack}
                className="flex items-center gap-1 text-[#3478F6] active:opacity-50 transition-opacity ml-[-12px] h-12 px-3 group"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-active:scale-95 transition-transform">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
                <span className="text-[17px] font-medium">
                  {viewStack[viewStack.length - 2] === 'projects' ? 'Projects' : unreadTotal || ''}
                </span>
              </button>
            </>
          )}
        </div>

                {/* Dynamic List Content */}
                <div className="flex-1 overflow-y-auto px-2 pb-32">
                  {currentScene === 'projects' ? (
                    /* Scene 1: Project List */
                    <div className="space-y-0.5">
                      {projects
                        .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map((project) => {
                          const initials = project.name.substring(0, 2).toUpperCase();
                          const count = activeAgentCount(project);
                          return (
                            <div
                              key={project.key}
                              onClick={() => openProject(project)}
                              className="flex items-center cursor-pointer group hover:bg-black/[0.03] active:bg-black/[0.05] rounded-xl mx-1 transition-all duration-200 border-b border-black/[0.05] last:border-transparent py-2 lg:py-1.5"
                            >
                              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-[12px] lg:text-[11px] font-bold text-gray-500 ml-2 mr-3 flex-shrink-0">
                                {initials}
                              </div>
                              <div className="flex-1 min-w-0 pr-4">
                                <div className="flex justify-between items-baseline">
                                  <span className="font-bold text-[15px] lg:text-[14px] truncate">{project.name}</span>
                                  {count > 0 && <div className="w-1.5 h-1.5 rounded-full bg-[#27C93F] animate-pulse ml-2" />}
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-[13px] lg:text-[12px] text-gray-500 truncate">
                                    {project.sessionCount} sessions
                                  </div>
                                </div>
                              </div>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-200 mr-4 flex-shrink-0">
                                <path d="m9 18 6-6-6-6"/>
                              </svg>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    /* Scene 2: Unified Messages List */
                    <div className="space-y-0.5">
                      {/* Sort logic: Running agents first, then by date */}
                      {[...sessions]
                        .filter(s => (s.title || s.id).toLowerCase().includes(searchQuery.toLowerCase()))
                        .sort((a, b) => {
                          const aRunning = agents.some(ag => ag.id === a.id) ? 1 : 0;
                          const bRunning = agents.some(ag => ag.id === b.id) ? 1 : 0;
                          if (aRunning !== bRunning) return bRunning - aRunning;
                          return new Date(b.modified).getTime() - new Date(a.modified).getTime();
                        })
                        .map((session, idx, arr) => {
                          const isWarm = agents.some(ag => ag.id === session.id);
                          const showActiveHeader = isWarm && idx === 0;
                          const showRecentHeader = !isWarm && (idx === 0 || (idx > 0 && agents.some(ag => ag.id === arr[idx-1].id)));
        
                          const initials = (session.title || "?").substring(0, 2).toUpperCase();
                          const isSelected = activeAgentIds.includes(session.id);
                          
                          const date = new Date(session.modified);
                          const today = new Date();
                          const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
                          const timestampStr = isToday ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : date.toLocaleDateString([], {weekday: 'short'});
        
                          return (
                            <div key={session.id}>
                              {showActiveHeader && (
                                <div className="px-4 pt-4 pb-1 text-[11px] font-bold text-[#27C93F] uppercase tracking-widest flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#27C93F] animate-pulse" />
                                  Live Now
                                </div>
                              )}
                              {showRecentHeader && (
                                <div className="px-4 pt-4 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                                  Recent
                                </div>
                              )}
                              <div
                                onClick={() => startAgent(session.id, false, session.projectPath)}
                                className={`flex items-center cursor-pointer group transition-all duration-300 border-b border-black/[0.05] last:border-transparent py-2 lg:py-1.5 ${
                                  isSelected 
                                    ? "bg-[#3478F6] text-white rounded-xl mx-1 shadow-md shadow-[#3478F6]/20 border-transparent" 
                                    : isWarm 
                                      ? "hover:bg-black/[0.03] opacity-100 bg-blue-50/30" 
                                      : "hover:bg-black/[0.03] opacity-60 hover:opacity-100"
                                }`}
                              >
                                <SessionAvatar session={{...session, status: isWarm ? 'running' : 'stopped'}} initials={initials} liveStatus={agentStatuses[session.id]} />
                                
                                <div className="flex-1 min-w-0 pr-4">
                                  <div className="flex justify-between items-baseline">
                                    <span className={`text-[15px] lg:text-[14px] truncate flex items-center gap-1.5 ${
                                      isSelected ? 'text-white font-bold'
                                      : session.hasUnread ? 'text-gray-900 font-bold'
                                      : 'text-gray-900 font-normal'
                                    }`}>
                                      {session.hasUnread && !isSelected && (
                                        <span className="inline-block w-2 h-2 rounded-full bg-[#007AFF] flex-shrink-0" />
                                      )}
                                      {session.title ?? session.id.slice(0, 8)}
                                    </span>
                                    <div className="relative flex-shrink-0 ml-2 h-full flex items-center min-w-[40px] justify-end">
                                      <span className={`text-[12px] lg:text-[11px] font-medium transition-opacity duration-200 group-hover:opacity-0 ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>
                                        {timestampStr}
                                      </span>
                                      <div className="absolute right-0 flex flex-row gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 py-1 items-center justify-center h-full">
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); handleRenameSession(session); }} 
                                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shadow-sm flex-shrink-0 group/btn ${isSelected ? 'bg-white/20' : 'bg-gray-400'}`}
                                        >
                                          <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="opacity-0 group-hover/btn:opacity-100 flex-shrink-0">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                          </svg>
                                        </button>
                                        {isWarm && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); killAgent(agents.find(a => a.id === session.id)!); }}
                                            className="w-3.5 h-3.5 rounded-full bg-[#ff5f56] flex items-center justify-center shadow-sm flex-shrink-0 group/btn"
                                          >
                                            <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="opacity-0 group-hover/btn:opacity-100 flex-shrink-0">
                                              <path d="M18 6 6 18M6 6l12 12"/>
                                            </svg>
                                          </button>
                                        )}
                                        {!isSelected && activeAgentIds.length < 4 && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); startAgent(session.id, true); }}
                                            className="w-3.5 h-3.5 rounded-full bg-[#27c93f] flex items-center justify-center shadow-sm flex-shrink-0 group/btn"
                                          >
                                            <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="opacity-0 group-hover/btn:opacity-100 flex-shrink-0">
                                              <path d="M12 5v14M5 12h14"/>
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className={`text-[13px] lg:text-[12px] truncate ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                                    {session.agentStatus === 'thinking'
                                      ? 'Typing...'
                                      : session.latestNotification
                                        ? session.latestNotification
                                        : (session.preview || "Active session")}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
        {/* Floating Search & Compose Dock */}
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:px-10 flex items-center gap-2 z-20 pointer-events-none">
          <div className="flex-1 h-10 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)] rounded-full border border-black/[0.03] flex items-center px-3 pointer-events-auto">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-400 mr-2 flex-shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input 
              type="text" 
              placeholder="Search" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-[16px] w-full text-gray-900 placeholder-gray-400 font-normal" 
            />
            <div className="p-1 text-gray-400 flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v4"/><path d="M8 23h8"/>
              </svg>
            </div>
          </div>
          <button
            onClick={() => startAgent()}
            className="w-10 h-10 rounded-full bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)] border border-black/[0.03] text-gray-400 flex items-center justify-center pointer-events-auto hover:bg-white active:scale-95 transition-all flex-shrink-0"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Main area - The Stage */}
      <div className={`flex-1 flex flex-col min-w-0 min-h-0 bg-white ${currentScene !== 'chat' ? 'hidden lg:flex' : 'flex'}`}>
        {onboardingProject ? (
          <ProjectOnboardingView 
            onComplete={completeOnboarding}
            onCancel={() => {
              setOnboardingProject(false);
              if (activeAgentIds.length === 0) setViewStack(["projects"]);
            }}
          />
        ) : activeAgentIds.length > 0 ? (
          <div className={`flex-1 grid gap-px bg-black/[0.05] lg:${getGridClass(activeAgentIds.length)} grid-cols-1 grid-rows-1 min-h-0`}>
            {activeAgentIds.map((id, index) => {
              const agent = agents.find(a => a.id === id);
              const isHiddenOnMobile = index !== activeAgentIds.length - 1;
              return (
                <div key={id} className={`bg-white flex flex-col min-h-0 overflow-hidden relative group ${isHiddenOnMobile ? "hidden lg:flex" : "flex"}`}>
                  <div className={`h-20 lg:h-14 flex-shrink-0 border-b border-black/[0.05] flex items-center px-4 justify-between pt-6 lg:pt-0 bg-white/80 backdrop-blur-md sticky top-0 z-30 ${agentStatuses[id] === "thinking" ? "breathing-glow" : "breathing-glow-fade"}`}>
                    {/* Mobile back button */}
                    <button
                      onClick={goBack}
                      className="lg:hidden flex items-center gap-1 text-[#3478F6] min-w-[70px] h-full px-4 ml-[-16px] active:opacity-50 transition-opacity"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6"/>
                      </svg>
                    </button>

                    {/* Avatar + Title — same layout as sidebar row */}
                    <div className="flex items-center gap-3 flex-1 min-w-0 lg:ml-2">
                      {/* Initials circle — same as SessionAvatar, with breathing ring */}
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-all duration-500 ${
                        agentStatuses[id] === "thinking"
                          ? "bg-blue-50 text-[#007AFF] breathing-glow-ring"
                          : "bg-blue-50 text-[#007AFF]"
                      }`}>
                        {(agent?.title || "?").substring(0, 2).toUpperCase()}
                      </div>

                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[14px] font-bold text-gray-900 truncate leading-tight">
                          {agent?.title || "Untitled Chat"}
                        </span>
                        {/* Model picker — visible on all screen sizes */}
                        <div className="relative flex-shrink-0">
                          <select
                            value={agent?.model || 'sonnet'}
                            onChange={(e) => {
                              e.stopPropagation();
                              switchAgentModel(id, e.target.value);
                            }}
                            className="appearance-none bg-gray-100/70 hover:bg-gray-200/70 text-gray-500 hover:text-gray-700 text-[11px] font-medium rounded-full pl-2 pr-5 py-0.5 border-none outline-none cursor-pointer transition-colors capitalize"
                            title="Switch model"
                          >
                            <option value="sonnet">Sonnet</option>
                            <option value="haiku">Haiku</option>
                            <option value="opus">Opus</option>
                          </select>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                            <path d="m6 9 6 6 6-6"/>
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons — visible on hover */}
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity min-w-[44px] justify-end">
                      {agent && <button onClick={(e) => { e.stopPropagation(); killAgent(agent); }} className="w-4 h-4 rounded-full bg-[#ff5f56] flex items-center justify-center shadow-sm flex-shrink-0 group/btn"><svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="opacity-0 group-hover/btn:opacity-100 flex-shrink-0"><path d="M18 6 6 18M6 6l12 12"/></svg></button>}
                      <button onClick={(e) => { e.stopPropagation(); removeFromStage(id); }} className="w-4 h-4 rounded-full bg-[#ffbd2e] flex items-center justify-center shadow-sm flex-shrink-0 group/btn"><svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="opacity-0 group-hover/btn:opacity-100 flex-shrink-0"><path d="M5 12h14"/></svg></button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ChatView
                      key={id}
                      agentId={id}
                      onTitleUpdate={(title) => handleTitleUpdate(id, title)}
                      onUnreadReset={() => handleUnreadReset(id)}
                      onStatusChange={handleStatusChange}
                      onModelSwitch={switchAgentModel}
                      currentModel={agent?.model || "sonnet"}
                      isTiled={activeAgentIds.length > 1}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center space-y-6">
            <div className="w-20 h-20 rounded-[32px] bg-gray-50 flex items-center justify-center text-gray-200">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h2 className="text-[18px] font-bold text-gray-800">Select a project or session to start messaging.</h2>
          </div>
        )}
      </div>
    </div>
  );
}
