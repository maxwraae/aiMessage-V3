import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';

export interface MuxSession {
  sessionId: string;
  muxName: string;
  pid: number | null;
}

/**
 * MuxManager handles the tmux lifecycle (The "Glass Office").
 */
export class MuxManager extends EventEmitter {
  constructor() {
    super();
  }

  private getMuxName(sessionId: string): string {
    return `aim-session-${sessionId.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  }

  private shellEscape(str: string): string {
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const muxName = this.getMuxName(sessionId);
    try {
      execSync(`tmux has-session -t "${muxName}" 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(sessionId: string, sessionDir: string, model: string, projectDir: string): Promise<MuxSession> {
    const muxName = this.getMuxName(sessionId);

    // Path to wrapper script (co-located with this module)
    const wrapperPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wrapper.sh');

    // Launch wrapper.sh inside tmux — wrapper handles its own restart loop
    const cmd = `bash ${this.shellEscape(wrapperPath)} ${this.shellEscape(sessionDir)} ${this.shellEscape(model)} ${this.shellEscape(projectDir)}`;
    execSync(`tmux new-session -d -s ${this.shellEscape(muxName)} ${this.shellEscape(cmd)}`);

    // Poll until session is confirmed alive (max 2s)
    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (await this.sessionExists(sessionId)) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      sessionId,
      muxName,
      pid: await this.getPanePid(sessionId)
    };
  }

  async getPanePid(sessionId: string): Promise<number | null> {
    const muxName = this.getMuxName(sessionId);
    try {
      const pidStr = execSync(`tmux display-message -t ${this.shellEscape(muxName)} -p "#{pane_pid}"`).toString().trim();
      return parseInt(pidStr, 10);
    } catch {
      return null;
    }
  }

  async killSession(sessionId: string): Promise<void> {
    const muxName = this.getMuxName(sessionId);
    try {
      execSync(`tmux kill-session -t ${this.shellEscape(muxName)} 2>/dev/null`);
    } catch { /* ignored */ }
  }

  async sendKeys(sessionId: string, keys: string): Promise<void> {
    const muxName = this.getMuxName(sessionId);
    // Use -l for literal string to avoid tmux interpreting special characters
    execSync(`tmux send-keys -t ${this.shellEscape(muxName)} -l ${this.shellEscape(keys)}`);
    execSync(`tmux send-keys -t ${this.shellEscape(muxName)} Enter`);
  }

  async setEnv(sessionId: string, name: string, value: string): Promise<void> {
    const muxName = this.getMuxName(sessionId);
    execSync(`tmux set-environment -t ${this.shellEscape(muxName)} ${this.shellEscape(name)} ${this.shellEscape(value)}`);
  }

  async listActiveSessions(): Promise<string[]> {
    try {
      const output = execSync('tmux list-sessions -F "#{session_name}"').toString();
      return output
        .split('\n')
        .filter(name => name.startsWith('aim-session-'))
        .map(name => name.replace(/^aim-session-/, ''));
    } catch {
      return [];
    }
  }

  async sendInterrupt(sessionId: string): Promise<void> {
    const muxName = this.getMuxName(sessionId);
    try {
      execSync(`tmux send-keys -t ${this.shellEscape(muxName)} C-c`);
    } catch { /* session might not exist */ }
  }

  async reconcileSessions(sessionsBaseDir: string): Promise<{ alive: string[], orphaned: string[] }> {
    const tmuxSessions = await this.listActiveSessions();
    const alive: string[] = [];
    const orphaned: string[] = [];

    for (const sessionId of tmuxSessions) {
      const metadataPath = path.join(sessionsBaseDir, sessionId, 'metadata.json');
      try {
        await fs.access(metadataPath);
        alive.push(sessionId);
      } catch {
        orphaned.push(sessionId);
      }
    }

    return { alive, orphaned };
  }
}
