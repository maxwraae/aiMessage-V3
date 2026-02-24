import { useEffect, useState, useRef } from "react";
import TerminalView from "./components/TerminalView";
import ChatView from "./components/ChatView";

type Project = {
  key: string;
  path: string;
  name: string;
  lastActivity: string;
  sessionCount: number;
};

type TerminalAgent = {
  id: string;
  type: "terminal";
  projectPath: string;
  tmuxSession: string;
  status: "running" | "stopped";
  startedAt: string;
};

type ChatAgentData = {
  id: string;
  type: "chat";
  projectPath: string;
  companionSession: string;
  status: "running" | "stopped";
  startedAt: string;
};

type AnyAgent = TerminalAgent | ChatAgentData;

type Session = {
  id: string;
  title: string | null;
  preview: string | null;
  created: string;
  modified: string;
};

type SelectedState = {
  agent: AnyAgent;
  view: "chat" | "terminal";
};

// Returns the WebSocket path for the terminal view of any agent
function terminalWsPath(agent: AnyAgent): string {
  if (agent.type === "terminal") return agent.tmuxSession;
  return agent.companionSession;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<AnyAgent[]>([]);
  const [selected, setSelected] = useState<SelectedState | null>(null);
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
    setSelected(null);
    setSessions([]);
    fetch(`/api/projects/${encodeURIComponent(project.key)}/sessions`)
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => {});
  }

  function goBack() {
    setSelectedProject(null);
    setSessions([]);
    setSelected(null);
  }

  async function startAgent(type: "chat" | "terminal", resumeSessionId?: string) {
    if (!selectedProject) return;
    setSpawning(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: selectedProject.path,
          type,
          resumeSessionId,
        }),
      });
      const agent: AnyAgent = await res.json();
      setAgents((prev) => [...prev, agent]);
      setSelected({ agent, view: type === "chat" ? "chat" : "terminal" });
    } catch {
      // ignore
    } finally {
      setSpawning(false);
    }
  }

  async function killAgent(agent: AnyAgent) {
    await fetch(`/api/agents/${agent.id}`, { method: "DELETE" }).catch(() => {});
    setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    if (selected?.agent.id === agent.id) setSelected(null);
  }

  function selectAgent(agent: AnyAgent) {
    setSelected({
      agent,
      view: agent.type === "chat" ? "chat" : "terminal",
    });
  }

  function toggleView() {
    if (!selected) return;
    setSelected((prev) =>
      prev
        ? { ...prev, view: prev.view === "chat" ? "terminal" : "chat" }
        : null
    );
  }

  const projectAgents = selectedProject
    ? agents.filter((a) => a.projectPath === selectedProject.path && a.status === "running")
    : [];

  const activeAgentCount = (p: Project) =>
    agents.filter((a) => a.projectPath === p.path && a.status === "running").length;

  const chatAgentCount = selectedProject
    ? agents.filter((a) => a.projectPath === selectedProject.path && a.type === "chat" && a.status === "running").length
    : 0;

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
            <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => startAgent("chat")}
                disabled={spawning}
                className="text-xs text-[#7aa2f7] hover:text-[#89b4fa] disabled:opacity-50"
                title="New chat agent"
              >
                {spawning ? "…" : "+ Chat"}
              </button>
              <span className="text-[#292e42]">|</span>
              <button
                onClick={() => startAgent("terminal")}
                disabled={spawning}
                className="text-xs text-[#565f89] hover:text-[#a9b1d6] disabled:opacity-50"
                title="New terminal agent"
              >
                Term
              </button>
            </div>
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
                const isSelected = selected?.agent.id === agent.id;
                return (
                  <div
                    key={agent.id}
                    onClick={() => selectAgent(agent)}
                    className={`px-3 py-2.5 rounded-lg cursor-pointer mb-0.5 group flex items-center justify-between ${
                      isSelected ? "bg-[#292e42]" : "hover:bg-[#1f2335]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#7aa2f7] truncate flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#9ece6a] flex-shrink-0" />
                        {agent.type === "chat" ? "chat" : "term"}-{agent.id}
                      </div>
                      <div className="text-xs text-[#565f89] mt-0.5">{agent.type}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); killAgent(agent); }}
                      className="text-xs text-[#565f89] hover:text-[#f7768e] opacity-0 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}

              {/* Past sessions */}
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => startAgent("terminal", session.id)}
                  className="px-3 py-2.5 rounded-lg mb-0.5 hover:bg-[#1f2335] cursor-pointer"
                >
                  <div className="text-sm text-[#c0caf5] truncate">
                    {session.title ?? session.id.slice(0, 8)}
                  </div>
                  {session.preview && (
                    <div className="text-xs text-[#565f89] mt-0.5 truncate">{session.preview}</div>
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

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Header bar with toggle */}
            <div className="h-9 flex-shrink-0 bg-[#16161e] border-b border-[#292e42] flex items-center px-4">
              <span className="text-xs text-[#565f89] truncate flex-1">
                {selected.agent.type === "chat" ? "chat" : "term"}-{selected.agent.id}
              </span>
              {/* Toggle: only chat agents can toggle */}
              {selected.agent.type === "chat" && (
                <button
                  onClick={toggleView}
                  className="flex-shrink-0 text-xs px-2.5 py-1 rounded-md border border-[#292e42] text-[#565f89] hover:text-[#c0caf5] hover:border-[#414868] transition-colors"
                >
                  {selected.view === "chat" ? "Terminal" : "Chat"}
                </button>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {selected.view === "chat" && selected.agent.type === "chat" ? (
                <ChatView agentId={selected.agent.id} />
              ) : (
                <TerminalView agentId={terminalWsPath(selected.agent)} />
              )}
            </div>
          </>
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
