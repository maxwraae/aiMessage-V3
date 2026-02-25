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
    <div className="flex h-screen bg-[#ececec] text-gray-900 overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-[320px] flex-shrink-0 bg-[#f5f5f7] border-r border-[#d1d1d6] flex flex-col z-10">

        {/* Header with Mac Controls and Menu */}
        <div className="pt-4 px-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e]" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
          </div>
          <button className="text-gray-500 hover:text-gray-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-4 pb-3 pt-2">
          <div className="bg-[#e3e3e8] rounded-lg flex items-center px-2.5 py-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-500 mr-2 flex-shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input 
              type="text" 
              placeholder="Search" 
              className="bg-transparent border-none outline-none text-[13px] w-full text-gray-800 placeholder-gray-500" 
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto bg-white rounded-tl-xl border-t border-[#d1d1d6]">
          <div className="pt-2">
            {projects.map((project) => {
              const count = activeAgentCount(project);
              const isExpanded = selectedProject?.key === project.key;
              
              return (
                <div key={project.key} className="flex flex-col">
                  {/* Project Header as a list item if not expanded, or as a section header if we want */}
                  <div
                    onClick={() => isExpanded ? goBack() : openProject(project)}
                    className={`flex items-center px-4 py-2 cursor-pointer transition-colors ${
                      isExpanded ? "bg-gray-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="w-3 flex-shrink-0 flex justify-center">
                      <svg 
                        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" 
                        className={`text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                      >
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0 ml-3 flex items-center justify-between">
                      <span className="font-semibold text-[14px] text-gray-800 truncate">{project.name}</span>
                      {count > 0 && (
                        <span className="flex-shrink-0 text-[11px] bg-gray-200 text-gray-600 font-bold rounded-full px-2 py-0.5">
                          {count} Active
                        </span>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="flex flex-col">
                      {/* Active Agents */}
                      {projectAgents.map((agent, idx) => {
                        const isSelected = activeAgentIds.includes(agent.id);
                        const initials = (agent.title || "?").substring(0, 2).toUpperCase();
                        
                        return (
                          <div
                            key={agent.id}
                            onClick={() => toggleAgentOnStage(agent.id)}
                            className={`flex items-center cursor-pointer group ${
                              isSelected ? "bg-[#3478F6] text-white rounded-xl mx-2 my-1 shadow-sm" : "hover:bg-gray-50 mx-0 my-0"
                            }`}
                          >
                            <div className={`w-4 flex-shrink-0 flex justify-center ${isSelected ? 'ml-2' : 'ml-2'}`}>
                              {agent.unreadCount > 0 ? (
                                <div className="w-2.5 h-2.5 bg-[#3478F6] rounded-full" />
                              ) : (
                                <div className={`w-2.5 h-2.5 rounded-full ${
                                  agent.agentStatus === "thinking" ? "bg-amber-400 animate-pulse" : 
                                  agent.agentStatus === "error" ? "bg-red-500" : "bg-green-500"
                                }`} />
                              )}
                            </div>
                            
                            <div className={`w-11 h-11 rounded-full flex items-center justify-center text-[17px] font-medium flex-shrink-0 mx-2 ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-[#a3b1c6] text-white'
                            }`}>
                              {initials}
                            </div>
                            
                            <div className={`flex-1 min-w-0 flex flex-col justify-center py-3 pr-4 border-b ${
                              isSelected || idx === projectAgents.length - 1 ? 'border-transparent' : 'border-gray-200'
                            }`}>
                              <div className="flex justify-between items-baseline mb-0.5">
                                <span className={`font-semibold text-[15px] truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                                  {agent.title}
                                </span>
                                <div className="relative flex-shrink-0 ml-2 h-5 flex items-center min-w-[50px] justify-end">
                                  <span className={`text-[13px] transition-opacity duration-200 group-hover:opacity-0 ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                                    Now
                                  </span>
                                  <div className="absolute right-0 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); killAgent(agent); }}
                                      className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:brightness-90 flex items-center justify-center group/btn"
                                      title="Close Session"
                                    >
                                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                                        <path d="M18 6 6 18M6 6l12 12"/>
                                      </svg>
                                    </button>
                                    <button
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        isSelected ? removeFromStage(agent.id) : toggleAgentOnStage(agent.id); 
                                      }}
                                      className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] hover:brightness-90 flex items-center justify-center group/btn"
                                      title={isSelected ? "Minimize (Remove from view)" : "Show in view"}
                                    >
                                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                                        {isSelected ? <path d="M5 12h14"/> : <path d="M12 5v14M5 12h14"/>}
                                      </svg>
                                    </button>
                                    {!isSelected && activeAgentIds.length < 4 && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleAgentOnStage(agent.id, true); }}
                                        className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] hover:brightness-90 flex items-center justify-center group/btn"
                                        title="Add to split view"
                                      >
                                        <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                                          <path d="M12 5v14M5 12h14"/>
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-[14px] truncate ${isSelected ? 'text-white/90' : 'text-gray-500'}`}>
                                  {agent.agentStatus === "thinking" ? "Typing..." : "Active session"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* New Session Action */}
                      <div className="px-14 py-2 border-b border-gray-200">
                         <button
                          onClick={() => startAgent()}
                          disabled={spawning}
                          className="text-[14px] text-[#3478F6] hover:text-[#2a62cc] font-medium transition-colors disabled:opacity-50"
                        >
                          + New Session
                        </button>
                      </div>

                      {/* Past Sessions */}
                      {sessions.map((session, idx) => {
                        const isSelected = activeAgentIds.includes(session.id); // Typically not selected unless resumed, but good to check
                        const initials = (session.title || "?").substring(0, 2).toUpperCase();
                        
                        // Parse timestamp for "Yesterday", "Monday", etc.
                        const date = new Date(session.modified);
                        const today = new Date();
                        const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
                        const timestampStr = isToday ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : date.toLocaleDateString([], {weekday: 'short'});

                        return (
                          <div
                            key={session.id}
                            onClick={() => startAgent(session.id)}
                            className={`flex items-center cursor-pointer group ${
                              isSelected ? "bg-[#3478F6] text-white rounded-xl mx-2 my-1 shadow-sm" : "hover:bg-gray-50 mx-0 my-0"
                            }`}
                          >
                            <div className="w-4 flex-shrink-0 ml-2" /> {/* Spacer for unread dot area */}
                            
                            <div className={`w-11 h-11 rounded-full flex items-center justify-center text-[17px] font-medium flex-shrink-0 mx-2 ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-[#a3b1c6] text-white'
                            }`}>
                              {initials}
                            </div>
                            
                            <div className={`flex-1 min-w-0 flex flex-col justify-center py-3 pr-4 border-b ${
                              isSelected || idx === sessions.length - 1 ? 'border-transparent' : 'border-gray-200'
                            }`}>
                              <div className="flex justify-between items-baseline mb-0.5">
                                <span className={`font-semibold text-[15px] truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                                  {session.title ?? session.id.slice(0, 8)}
                                </span>
                                <div className="relative flex-shrink-0 ml-2 h-5 flex items-center min-w-[50px] justify-end">
                                  <span className={`text-[13px] transition-opacity duration-200 group-hover:opacity-0 ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                                    {timestampStr}
                                  </span>
                                  <div className="absolute right-0 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); /* Implement delete logic if available, for now just a UI stub */ }}
                                      className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:brightness-90 flex items-center justify-center group/btn"
                                      title="Delete Session"
                                    >
                                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                                        <path d="M18 6 6 18M6 6l12 12"/>
                                      </svg>
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); startAgent(session.id); }}
                                      className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] hover:brightness-90 flex items-center justify-center group/btn"
                                      title="Resume Session"
                                    >
                                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                                        <path d="M5 12h14"/>
                                      </svg>
                                    </button>
                                    {activeAgentIds.length < 4 && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); startAgent(session.id, true); }}
                                        className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] hover:brightness-90 flex items-center justify-center group/btn"
                                        title="Resume in split view"
                                      >
                                        <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                                          <path d="M12 5v14M5 12h14"/>
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-[14px] truncate ${isSelected ? 'text-white/90' : 'text-gray-500'}`}>
                                  {session.preview || "No messages yet"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {projects.length === 0 && (
              <div className="px-4 py-8 text-center text-[14px] text-gray-400">Loading…</div>
            )}
          </div>
        </div>
      </div>

      {/* Main area - The Stage */}
      <div className="flex-1 flex flex-col overflow-hidden relative bg-white">
        {activeAgentIds.length > 0 ? (
          <div className={`flex-1 grid gap-px bg-gray-200 ${getGridClass(activeAgentIds.length)}`}>
            {activeAgentIds.map((id, index) => {
              const agent = agents.find(a => a.id === id);
              const isHiddenOnMobile = index !== activeAgentIds.length - 1;
              
              return (
                <div 
                  key={id} 
                  className={`bg-white flex flex-col overflow-hidden relative ${isHiddenOnMobile ? "hidden lg:flex" : "flex"} ${
                    activeAgentIds.length === 3 && index === 0 ? "lg:row-span-2" : ""
                  }`}
                >
                  {/* Tile Header */}
                  <div className="h-12 flex-shrink-0 bg-gray-50 border-b border-gray-200 flex items-center px-4 justify-between group/header">
                    <span className="text-[12px] uppercase tracking-wider font-bold text-gray-500 truncate">
                      {agent?.title || "Loading..."}
                    </span>
                    <div className="flex items-center gap-2 opacity-50 group-hover/header:opacity-100 transition-opacity">
                      {agent && (
                        <button
                          onClick={(e) => { e.stopPropagation(); killAgent(agent); }}
                          className="w-3.5 h-3.5 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:brightness-90 flex items-center justify-center group/btn"
                          title="Close Session"
                        >
                          <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                            <path d="M18 6 6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromStage(id); }}
                        className="w-3.5 h-3.5 rounded-full bg-[#ffbd2e] border border-[#dea123] hover:brightness-90 flex items-center justify-center group/btn"
                        title="Minimize (Remove from view)"
                      >
                        <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-black opacity-0 group-hover/btn:opacity-100">
                          <path d="M5 12h14"/>
                        </svg>
                      </button>
                      {/* Green button hidden because chat is already open on stage */}
                    </div>
                  </div>
                  
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
          <div className="flex-1 flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center text-gray-300">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <span className="text-[15px] text-gray-400 font-medium">
              {selectedProject ? "Start a new session or select one" : "Select a project to begin"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
