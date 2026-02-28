import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isNoise } from '../../shared/filter-config.js';

export type SessionStatus = 'idle' | 'busy' | 'sleeping' | 'error';

export interface SessionMetadata {
  sessionId: string;
  claudeSessionId?: string;
  projectPath: string;
  model: string;
  status: SessionStatus;
  lastSeen: string;
  lastProcessedInputId?: string;
}

export interface InputEntry {
  id: string;
  clientId: string;
  type: 'user' | 'system' | 'command';
  text: string;
  timestamp: string;
}

/**
 * JournalManager handles the persistent filesystem state for a session.
 * It manages the Input Journal (in.jsonl), Output Journal (out.jsonl), 
 * and Metadata (metadata.json).
 */
export class JournalManager extends EventEmitter {
  private baseDir: string;
  private sessionDir: string;

  constructor(private sessionId: string) {
    super();
    this.baseDir = path.join(os.homedir(), '.aimessage', 'sessions');
    this.sessionDir = path.join(this.baseDir, sessionId);
  }

  /**
   * Ensures the session directory and required files exist.
   */
  async ensureStorage(): Promise<void> {
    await fs.mkdir(this.sessionDir, { recursive: true });
    
    const files = ['in.jsonl', 'out.jsonl'];
    for (const file of files) {
      const filePath = path.join(this.sessionDir, file);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, '');
      }
    }
  }

  /**
   * Appends an entry to the Input Journal. (Strictly Append-Only)
   */
  async appendInput(entry: Omit<InputEntry, 'timestamp'>): Promise<InputEntry> {
    const fullEntry: InputEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    const filePath = path.join(this.sessionDir, 'in.jsonl');
    await fs.appendFile(filePath, JSON.stringify(fullEntry) + '\n');
    return fullEntry;
  }

  /**
   * Appends a raw string/JSON block to the Output Journal.
   */
  async appendOutput(data: string): Promise<void> {
    const filePath = path.join(this.sessionDir, 'out.jsonl');
    const line = data.endsWith('\n') ? data : data + '\n';
    await fs.appendFile(filePath, line);
  }

  /**
   * Reads the current metadata for the session.
   */
  async getMetadata(): Promise<SessionMetadata | null> {
    const filePath = path.join(this.sessionDir, 'metadata.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private writeLock: Promise<void> = Promise.resolve();

  /**
   * Updates session metadata.
   */
  async updateMetadata(update: Partial<SessionMetadata>): Promise<void> {
    const nextLock = this.writeLock.then(async () => {
      const current = (await this.getMetadata()) || {
        sessionId: this.sessionId,
        projectPath: process.cwd(),
        model: 'default',
        status: 'idle',
        lastSeen: new Date().toISOString()
      };

      const updated = {
        ...current,
        ...update,
        lastSeen: new Date().toISOString()
      };

      const filePath = path.join(this.sessionDir, 'metadata.json');
      const tempPath = filePath + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      
      await fs.writeFile(tempPath, JSON.stringify(updated, null, 2));
      await fs.rename(tempPath, filePath);
    });

    this.writeLock = nextLock.catch(() => {}); // Prevent chain break on error
    return nextLock;
  }

  getOutPath(): string {
    return path.join(this.sessionDir, 'out.jsonl');
  }

  getInPath(): string {
    return path.join(this.sessionDir, 'in.jsonl');
  }

  /**
   * High-fidelity incremental hydration.
   */
  async hydrate(projectPath: string, claudeSessionId?: string): Promise<boolean> {
    const sessionId = claudeSessionId || this.sessionId;
    const projectSlug = projectPath.replace(/\//g, "-");
    const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
    
    let projectDir: string | null = null;
    try {
      const dirs = await fs.readdir(claudeProjectsDir);
      console.log(`[Journal] Searching for slug: "${projectSlug}" in Vault. Available dirs:`, dirs);
      projectDir = dirs.find(d => d.includes(projectSlug) || d === projectSlug || d === `-${projectSlug}`) || null;
      console.log(`[Journal] Matched projectDir: "${projectDir}"`);
    } catch { return false; }

    if (!projectDir) return false;

    const rawLogPath = path.join(claudeProjectsDir, projectDir, `${sessionId}.jsonl`);
    console.log(`[Journal] Checking for Vault log at: ${rawLogPath}`);
    try {
      await fs.access(rawLogPath);
      console.log(`[Journal] Found Vault log file.`);
    } catch { 
      console.log(`[Journal] Vault log NOT FOUND at ${rawLogPath}`);
      return false; 
    }

    // 1. Get all current unique IDs in our local journal to prevent duplicates
    const localHistory = await this.readOutputHistory();
    const localStreamItems = localHistory.filter(line => {
      try { return JSON.parse(line).type === 'stream_item'; } catch { return false; }
    });
    
    console.log(`[Journal] Current local stream items: ${localStreamItems.length}`);
    const knownIds = new Set(localHistory.map(line => {
      try { 
        const frame = JSON.parse(line);
        return frame.item.id;
      } catch { return null; }
    }).filter(Boolean));

    // 2. Read Vault
    const content = await fs.readFile(rawLogPath, 'utf-8');
    const rawLines = content.split('\n').filter(l => l.trim());
    console.log(`[Journal] Read ${rawLines.length} lines from Vault.`);
    const outPath = this.getOutPath();

    let importCount = 0;
    for (const line of rawLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.isSidechain === true) continue;

        // Use the original Claude UUID as our primary key
        const claudeId = entry.uuid || entry.message?.id || crypto.randomBytes(3).toString('hex');
        if (knownIds.has(claudeId)) continue;

        let items: any[] = [];

        // Catch User Message (Text or Object format)
        if (entry.type === "user" || entry.role === "user") {
          const content = entry.message?.content || entry.content;
          const text = typeof content === "string" ? content : (Array.isArray(content) ? content.map((b: any) => b.text || "").join("") : "");
          if (text && !isNoise(text)) {
            items.push({ kind: 'user_message', text, id: claudeId, timestamp: new Date().toISOString() });
          }
        } 
        // Catch Assistant Message (Text, Thought, or Tool format)
        else if (entry.type === "assistant" || entry.role === "assistant") {
          const content = entry.message?.content || entry.content;
          const contents = Array.isArray(content) ? content : (content ? [content] : []);
          
          for (const block of contents) {
            const b = typeof block === 'string' ? { type: 'text', text: block } : block;
            if (b.type === 'text' && b.text && !isNoise(b.text)) {
              items.push({ kind: 'assistant_message', text: b.text, id: claudeId, timestamp: new Date().toISOString() });
            } else if (b.type === 'thinking' || b.type === 'thought') {
              items.push({ kind: 'thought', text: b.thinking || b.text, status: 'ready', id: claudeId + '-thought', timestamp: new Date().toISOString() });
            } else if (b.type === 'tool_use') {
              items.push({ kind: 'tool_call', name: b.name, input: b.input, status: 'completed', id: b.id || claudeId, timestamp: new Date().toISOString() });
            }
          }
        }

        for (const item of items) {
          const uiFrame = { type: 'stream_item', item };
          await fs.appendFile(outPath, JSON.stringify(uiFrame) + '\n');
          knownIds.add(item.id);
          importCount++;
        }
      } catch (err) { continue; }
    }

    console.log(`[Journal] Hydration complete. Imported ${importCount} new items.`);
    return true;
  }

  async readOutputHistory(): Promise<string[]> {
    try {
      const content = await fs.readFile(this.getOutPath(), 'utf-8');
      return content.split('\n').filter(line => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Reads all inputs from the journal.
   */
  async readInputHistory(): Promise<InputEntry[]> {
    try {
      const content = await fs.readFile(this.getInPath(), 'utf-8');
      return content.split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }
}
