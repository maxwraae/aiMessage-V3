import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type Agent = {
  id: string;
  projectPath: string;
  tmuxSession: string;
  status: "running" | "stopped";
  startedAt: Date;
};

const agents = new Map<string, Agent>();
const agentsDir = path.join(os.homedir(), ".aimessage", "agents");

function init() {
  fs.mkdirSync(agentsDir, { recursive: true });
  try {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const agent: Agent = JSON.parse(
        fs.readFileSync(path.join(agentsDir, file), "utf-8")
      );
      agent.startedAt = new Date(agent.startedAt);
      try {
        execSync(`tmux has-session -t ${agent.tmuxSession}`, { stdio: "ignore" });
        agent.status = "running";
      } catch {
        agent.status = "stopped";
      }
      agents.set(agent.id, agent);
    }
  } catch {
    // ignore
  }
}

function saveAgent(agent: Agent) {
  fs.writeFileSync(
    path.join(agentsDir, `${agent.id}.json`),
    JSON.stringify(agent)
  );
}

export function spawnAgent(projectPath: string, resumeSessionId?: string): Agent {
  const id = crypto.randomBytes(3).toString("hex");
  const sessionName = `agent-${id}`;

  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE;

  execSync(`tmux new-session -d -s ${sessionName}`, {
    env: env as NodeJS.ProcessEnv,
  });

  const escapedPath = projectPath.replace(/"/g, '\\"');
  const claudeCmd = resumeSessionId
    ? `claude --dangerously-skip-permissions --resume ${resumeSessionId}`
    : `claude --dangerously-skip-permissions`;
  execSync(
    `tmux send-keys -t ${sessionName} "cd \\"${escapedPath}\\" && unset CLAUDECODE && ${claudeCmd}" Enter`,
    { env: env as NodeJS.ProcessEnv }
  );

  const agent: Agent = {
    id,
    projectPath,
    tmuxSession: sessionName,
    status: "running",
    startedAt: new Date(),
  };

  saveAgent(agent);
  agents.set(id, agent);
  return agent;
}

export function listAgents(): Agent[] {
  return Array.from(agents.values());
}

export function getAgent(id: string): Agent | undefined {
  return agents.get(id);
}

export function killAgent(id: string): void {
  const agent = agents.get(id);
  if (!agent) return;
  try {
    execSync(`tmux kill-session -t ${agent.tmuxSession}`, { stdio: "ignore" });
  } catch {
    // ignore
  }
  agent.status = "stopped";
  saveAgent(agent);
  agents.delete(id);
}

init();
