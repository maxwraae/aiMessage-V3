import { useEffect, useState, useRef } from "react";
import ChatView from "./components/ChatView";

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
};

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<ChatAgentData[]>([]);
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [spawning, setSpawning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects).catch(() => {});
    fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {});

    pollRef.current = setInterval(() => {
      fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {});
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function openProject(project: Project) {
    setSelectedProject(project);
    setActiveAgentIds([]);
    setSessions([]);
    fetch(`/api/projects/${encodeURIComponent(project.key)}/sessions`)
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => {});
  }

  function goBack() {
    setSelectedProject(null);
    setSessions([]);
    setActiveAgentIds([]);
  }

  async function startAgent(resumeSessionId?: string, split: boolean = false) {
    if (!selectedProject) return;
    setSpawning(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: selectedProject.path,
          type: "chat",
          resumeSessionId,
        }),
      });
      const agent: ChatAgentData = await res.json();
      setAgents((prev) => [...prev, agent]);
      
      if (split && activeAgentIds.length < 4) {
        setActiveAgentIds(prev => [...prev, agent.id]);
      } else {
        setActiveAgentIds([agent.id]);
      }
    } catch {
      // ignore
    } finally {
      setSpawning(false);
    }
  }

  async function killAgent(agent: ChatAgentData) {
    await fetch(`/api/agents/${agent.id}`, { method: "DELETE" }).catch(() => {});
    setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    setActiveAgentIds((prev) => prev.filter((id) => id !== agent.id));
  }

  function toggleAgentOnStage(agentId: string, split: boolean = false) {
    if (split) {
      if (activeAgentIds.includes(agentId)) {
        // Flash effect or just do nothing
        return;
      }
      if (activeAgentIds.length < 4) {
        setActiveAgentIds(prev => [...prev, agentId]);
      }
    } else {
      setActiveAgentIds([agentId]);
    }
  }

  function removeFromStage(agentId: string) {
    setActiveAgentIds(prev => prev.filter(id => id !== agentId));
  }

  const projectAgents = selectedProject
    ? agents.filter((a) => a.projectPath === selectedProject.path && a.status === "running")
    : [];

  function handleTitleUpdate(agentId: string, newTitle: string) {
    setAgents((prev) => 
      prev.map((a) => a.id === agentId ? { ...a, title: newTitle } : a)
    );
  }

  function handleUnreadReset(agentId: string) {
    setAgents((prev) => 
      prev.map((a) => a.id === agentId ? { ...a, unreadCount: 0 } : a)
    );
  }

  const activeAgentCount = (p: Project) =>
    agents.filter((a) => a.projectPath === p.path && a.status === "running").length;

  // Grid layout logic
  const getGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 lg:grid-cols-2";
    return "grid-cols-1 lg:grid-cols-2 lg:grid-rows-2";
  };

  return (
    <div className="flex h-screen bg-[#1a1b26] text-[#a9b1d6]">
      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 bg-[#16161e] border-r border-[#292e42] flex flex-col">

        {/* Header */}
        <div className="p-4 border-b border-[#292e42] flex items-center gap-2">
          {selectedProject && (
            <button
              onClick={goBack}
              className="text-[#565f89] hover:text-[#c0caf5] text-sm leading-none"
            >
              ←
            </button>
          )}
          <h1 className="text-sm font-semibold text-[#7aa2f7] tracking-wide truncate">
            {selectedProject ? selectedProject.name : "aiMessage"}
          </h1>
          {selectedProject && (
            <button
              onClick={() => startAgent()}
              disabled={spawning}
              className="ml-auto text-xs text-[#7aa2f7] hover:text-[#89b4fa] disabled:opacity-50 flex-shrink-0"
              title="New session"
            >
              {spawning ? "…" : "+ New"}
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">

          {/* Project list */}
          {!selectedProject && projects.map((project) => {
            const count = activeAgentCount(project);
            return (
              <div
                key={project.key}
                onClick={() => openProject(project)}
                className="px-3 py-2.5 rounded-lg cursor-pointer flex items-center justify-between mb-0.5 hover:bg-[#1f2335]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#c0caf5] truncate">{project.name}</div>
                  <div className="text-xs text-[#565f89] mt-0.5">
                    {project.sessionCount} session{project.sessionCount !== 1 ? "s" : ""}
                  </div>
                </div>
                {count > 0 && (
                  <span className="ml-2 flex-shrink-0 text-xs bg-[#7aa2f7] text-[#1a1b26] font-semibold rounded-full w-5 h-5 flex items-center justify-center">
                    {count}
                  </span>
                )}
              </div>
            );
          })}

          {/* Agent list (inside a project) */}
          {selectedProject && (
            <>
              {projectAgents.map((agent) => {
                const isSelected = activeAgentIds.includes(agent.id);
                return (
                  <div
                    key={agent.id}
                    onClick={() => toggleAgentOnStage(agent.id)}
                    className={`px-3 py-2.5 rounded-lg cursor-pointer mb-0.5 group flex items-center justify-between transition-colors ${
                      isSelected ? "bg-[#292e42]" : "hover:bg-[#1f2335]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[#7aa2f7] truncate flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          agent.agentStatus === "thinking" ? "bg-[#e0af68] animate-pulse" : 
                          agent.agentStatus === "error" ? "bg-[#f7768e]" : "bg-[#9ece6a]"
                        }`} />
                        {agent.title}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Split View Toggle Icon */}
                      {!isSelected && activeAgentIds.length > 0 && activeAgentIds.length < 4 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleAgentOnStage(agent.id, true); }}
                          className="p-1 rounded text-[#565f89] hover:text-[#7aa2f7] hover:bg-[#16161e] opacity-0 group-hover:opacity-100 transition-all"
                          title="Add to split view"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18M3 12h18"/>
                          </svg>
                        </button>
                      )}
                      
                      {agent.unreadCount > 0 && (
                        <span className="flex-shrink-0 text-[10px] bg-[#f7768e] text-[#1a1b26] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                          {agent.unreadCount}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); killAgent(agent); }}
                        className="p-1 rounded text-[#565f89] hover:text-[#f7768e] hover:bg-[#16161e] opacity-0 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="h-4" />
              <div className="px-3 py-1 text-[10px] text-[#565f89] uppercase tracking-wider font-semibold">History</div>

              {/* Past sessions */}
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="px-3 py-2 rounded-lg mb-0.5 hover:bg-[#1f2335] cursor-pointer group flex items-center justify-between"
                  onClick={() => startAgent(session.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[#c0caf5] truncate group-hover:text-[#7aa2f7] transition-colors">
                      {session.title ?? session.id.slice(0, 8)}
                    </div>
                  </div>
                  
                  {/* Split View Icon for History */}
                  {activeAgentIds.length > 0 && activeAgentIds.length < 4 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); startAgent(session.id, true); }}
                      className="p-1 rounded text-[#565f89] hover:text-[#7aa2f7] hover:bg-[#16161e] opacity-0 group-hover:opacity-100 transition-all"
                      title="Resume in split view"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18M3 12h18"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}

              {sessions.length === 0 && projectAgents.length === 0 && (
                <div className="px-3 py-2 text-xs text-[#565f89]">No sessions yet</div>
              )}
            </>
          )}

          {!selectedProject && projects.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#565f89]">Loading…</div>
          )}
        </div>
      </div>

      {/* Main area - The Stage */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeAgentIds.length > 0 ? (
          <div className={`flex-1 grid gap-px bg-[#292e42] ${getGridClass(activeAgentIds.length)}`}>
            {activeAgentIds.map((id, index) => {
              const agent = agents.find(a => a.id === id);
              // In mobile (fallback), we only show the last active chat
              const isHiddenOnMobile = index !== activeAgentIds.length - 1;
              
              return (
                <div 
                  key={id} 
                  className={`bg-[#1a1b26] flex flex-col overflow-hidden relative ${isHiddenOnMobile ? "hidden lg:flex" : "flex"} ${
                    activeAgentIds.length === 3 && index === 0 ? "lg:row-span-2" : ""
                  }`}
                >
                  {/* Tile Header */}
                  {activeAgentIds.length > 1 && (
                    <div className="h-8 flex-shrink-0 bg-[#16161e] border-b border-[#292e42] flex items-center px-3 justify-between">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-[#565f89] truncate">
                        {agent?.title || "Loading..."}
                      </span>
                      <button 
                        onClick={() => removeFromStage(id)}
                        className="text-[#565f89] hover:text-[#f7768e] text-xs transition-colors"
                        title="Remove from view"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  
                  <div className="flex-1 overflow-hidden">
                    <ChatView 
                      agentId={id} 
                      onTitleUpdate={(title) => handleTitleUpdate(id, title)}
                      onUnreadReset={() => handleUnreadReset(id)}
                      isTiled={activeAgentIds.length > 1}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-[#565f89]">
              {selectedProject ? "Start a new agent or select one" : "Select a project"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
