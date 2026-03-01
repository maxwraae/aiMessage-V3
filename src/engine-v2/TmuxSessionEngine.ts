import { EventEmitter } from 'node:events';
import { JournalManager, SessionMetadata, InputEntry } from './JournalManager.js';
import { MuxManager } from './MuxManager.js';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as readline from 'node:readline';
import { spawn, ChildProcess } from 'node:child_process';
import { executeOneShot } from '../../lib/claude-one-shot.js';
import { isManuallyRenamed, setSessionTitle, getSessionTitle } from '../../session-discovery.js';

const SESSIONS_BASE = path.join(os.homedir(), '.aimessage', 'sessions');

const GOVERNANCE = {
  MAX_CONCURRENT_SESSIONS: 5,
  MAX_TMUX_SESSIONS: 10,
  ORPHAN_BUSY_TIMEOUT_MS: 60 * 60 * 1000,
  IDLE_REAP_MS: 10 * 60 * 1000,
  SESSION_TTL_MS: 4 * 60 * 60 * 1000,
  REAPER_INTERVAL_MS: 30 * 1000,
} as const;

/**
 * TmuxSessionEngine — manages Claude sessions via tmux + FIFOs.
 *
 * Architecture:
 *   Server writes → in.jsonl (persistence) + input.fifo (live pipe to Claude)
 *   Server tails  ← out.jsonl (Claude's stdout + server-injected user messages)
 *   tmux session  → runs wrapper.sh (while true: cat FIFO | claude >> out.jsonl)
 *
 * Sessions survive server restarts. The FIFO is the control channel:
 * when the server opens it for writing, wrapper unblocks; when the server
 * closes it, Claude gets EOF and exits. Wrapper loops and waits again.
 */
export class TmuxSessionEngine extends EventEmitter {
  private mux = new MuxManager();
  private journals = new Map<string, JournalManager>();
  private fifos = new Map<string, fs.WriteStream>();       // FIFO write streams
  private pendingWakes = new Map<string, Promise<void>>(); // prevent double-spawn
  private sessionStatus = new Map<string, 'sleeping' | 'idle' | 'busy'>();
  private monitors = new Map<string, { lastActivity: number }>();
  private sessionWatchers = new Map<string, { process: ChildProcess; refCount: number }>();
  private activeObservers: Map<string, number> = new Map(); // sessionId → observer count
  private reaperInterval: NodeJS.Timeout | null = null;
  private busySince = new Map<string, number>();            // sessionId → timestamp when busy started
  private processingLock = new Set<string>();               // prevent double submit race

  constructor() {
    super();
    this.startReaper();
  }

  // ── Journal accessor ──────────────────────────────────

  private async getJournal(sessionId: string): Promise<JournalManager> {
    let j = this.journals.get(sessionId);
    if (!j) {
      j = new JournalManager(sessionId);
      await j.ensureStorage();
      this.journals.set(sessionId, j);
    }
    return j;
  }

  private getSessionDir(sessionId: string): string {
    return path.join(SESSIONS_BASE, sessionId);
  }

  private getFifoPath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'input.fifo');
  }

  // ── Public API ────────────────────────────────────────

  /**
   * Configures a session and ensures the tmux process is alive.
   */
  async create(sessionId: string, projectPath: string, model: string): Promise<void> {
    const journal = await this.getJournal(sessionId);
    await journal.updateMetadata({ sessionId, projectPath, model, status: 'sleeping', createdAt: new Date().toISOString() });
    console.log(`[TmuxEngine] Configured session ${sessionId}: model=${model}`);
    await this.ensureAwake(sessionId);
  }

  /**
   * Submits user input. Writes to in.jsonl for persistence and triggers
   * FIFO delivery to the Claude process.
   */
  async submit(sessionId: string, clientId: string, text: string): Promise<void> {
    const journal = await this.getJournal(sessionId);

    const entry = await journal.appendInput({
      id: crypto.randomBytes(4).toString('hex'),
      clientId,
      type: 'user',
      text
    });

    // Write user_message to out.jsonl so the UI shows it immediately
    const uiFrame = {
      type: 'stream_item',
      item: {
        kind: 'user_message',
        text: entry.text,
        id: entry.id,
        timestamp: entry.timestamp
      }
    };
    await journal.appendOutput(JSON.stringify(uiFrame));

    const status = this.sessionStatus.get(sessionId);
    if (status === 'busy' || this.pendingWakes.has(sessionId)) {
      console.log(`[TmuxEngine] Session ${sessionId} busy/waking. Queued ${entry.id}.`);
      return;
    }

    await this.processNextInput(sessionId);
  }

  /**
   * Returns a ReadableStream for observing session output.
   *
   * The stream emits:
   *   1. agent_status (current + live changes)
   *   2. history_snapshot (all past stream_items)
   *   3. stream_item (live, from tailing out.jsonl)
   *
   * out.jsonl contains TWO kinds of lines:
   *   - stream_item frames (already transformed; written by submit() or transformClaudeFrame)
   *   - Raw Claude NDJSON (written directly by wrapper.sh's stdout redirect)
   *
   * The observer only forwards stream_item frames to the WebSocket.
   * Raw Claude frames trigger transformClaudeFrame which:
   *   - Writes new stream_item frames to out.jsonl (tail picks them up next)
   *   - Detects turn completion and manages status transitions
   *   - Captures Claude session IDs
   */
  async observe(sessionId: string, offset: number = 0): Promise<ReadableStream> {
    const journal = await this.getJournal(sessionId);
    const outPath = journal.getOutPath();
    const self = this;

    // Track resources that need cleanup when the observer disconnects
    let tailProcess: ReturnType<typeof spawn> | null = null;
    let rlInterface: readline.Interface | null = null;
    let syncIntervalId: NodeJS.Timeout | null = null;
    let statusChangeHandler: ((data: { sessionId: string; status: string }) => void) | null = null;

    const cleanup = () => {
      if (tailProcess) {
        tailProcess.kill('SIGTERM');
        tailProcess = null;
      }
      if (rlInterface) {
        rlInterface.close();
        rlInterface = null;
      }
      if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
      }
      if (statusChangeHandler) {
        self.off('status_change', statusChangeHandler);
        statusChangeHandler = null;
      }
      self.releaseTransformWatcher(sessionId);

      // Decrement observer count
      const count = (self.activeObservers.get(sessionId) || 1) - 1;
      if (count <= 0) {
        self.activeObservers.delete(sessionId);
      } else {
        self.activeObservers.set(sessionId, count);
      }
    };

    return new ReadableStream({
      async start(controller) {
        // Track this observer and mark session as viewed
        self.activeObservers.set(sessionId, (self.activeObservers.get(sessionId) || 0) + 1);
        await journal.updateMetadata({ lastViewedAt: new Date().toISOString() });

        // 1. Hydrate from Claude vault
        const meta = await journal.getMetadata();
        if (meta?.projectPath) {
          await journal.hydrate(meta.projectPath, meta.claudeSessionId);
          await self.ensureAwake(sessionId);
        }

        // Ensure the shared transform watcher is running for this session
        await self.ensureTransformWatcher(sessionId);

        // Periodic re-hydration from Claude's own vault
        syncIntervalId = setInterval(async () => {
          try {
            const m = await journal.getMetadata();
            if (m?.projectPath) {
              await journal.hydrate(m.projectPath, m.claudeSessionId);
            }
          } catch (err) {
            console.error(`[TmuxEngine] Sync hydration error for ${sessionId}:`, err);
          }
        }, 10000);

        // 2. Initial status
        const currentStatus = self.sessionStatus.get(sessionId) || 'idle';
        const uiStatus = currentStatus === 'busy' ? 'thinking' : 'idle';
        controller.enqueue(JSON.stringify({ type: 'agent_status', status: uiStatus }) + '\n');

        // 3. Status change listener
        statusChangeHandler = (data: { sessionId: string; status: string }) => {
          if (data.sessionId === sessionId) {
            const uiSt = data.status === 'busy' ? 'thinking' : 'idle';
            try {
              controller.enqueue(JSON.stringify({ type: 'agent_status', status: uiSt }) + '\n');
            } catch {
              /* controller already closed — WebSocket disconnected */
            }
          }
        };
        self.on('status_change', statusChangeHandler);

        // 4. History snapshot — only stream_items, raw Claude frames are invisible
        const history = await journal.readOutputHistory();
        const items = history
          .map(line => {
            try {
              const frame = JSON.parse(line);
              if (frame.type === 'stream_item') return frame.item;
              return null;
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        controller.enqueue(JSON.stringify({ type: 'history_snapshot', items }) + '\n');

        // 5. Live tail — start from current end to avoid duplicating history
        tailProcess = spawn('tail', ['-f', '-n', '0', outPath]);
        rlInterface = readline.createInterface({ input: tailProcess.stdout! });

        rlInterface.on('line', (line) => {
          if (!line.trim()) return;
          try {
            const frame = JSON.parse(line);

            if (frame.type === 'stream_item') {
              // Already-transformed frame — forward to WebSocket
              try {
                controller.enqueue(line + '\n');
              } catch {
                /* controller already closed */
              }
            }
            // Raw Claude NDJSON is handled by the shared transform watcher —
            // this observer only forwards stream_item frames.
          } catch {
            /* unparseable line — machine noise, skip */
          }
        });

        tailProcess.on('exit', () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },

      cancel() {
        // WebSocket disconnected — kill the tail process and clean up all resources
        cleanup();
      }
    });
  }

  /**
   * Returns current session metadata with live status overlay,
   * plus computed unread state and latest notification subject.
   */
  async getState(sessionId: string): Promise<(SessionMetadata & { hasUnread: boolean; latestNotification?: string }) | null> {
    const journal = await this.getJournal(sessionId);
    const meta = await journal.getMetadata();
    if (!meta) return null;

    const liveStatus = this.sessionStatus.get(sessionId);
    if (liveStatus) meta.status = liveStatus;

    const hasUnread = !!(meta.lastResultAt && (!meta.lastViewedAt || meta.lastResultAt > meta.lastViewedAt));

    let latestNotification: string | undefined;
    if (hasUnread) {
      // Scan output history backwards for the most recent notification after lastViewedAt
      const history = await journal.readOutputHistory();
      const viewedAt = meta.lastViewedAt || '1970-01-01';
      for (let i = history.length - 1; i >= 0; i--) {
        try {
          const frame = JSON.parse(history[i]);
          if (frame.type === 'stream_item' && frame.item?.kind === 'notification') {
            if (frame.item.timestamp > viewedAt) {
              latestNotification = frame.item.subject;
              break;
            }
          }
        } catch { continue; }
      }
    }

    return { ...meta, hasUnread, latestNotification };
  }

  /**
   * Returns IDs of sessions with an open FIFO (i.e., actively connected).
   */
  listActiveSessions(): string[] {
    return Array.from(this.fifos.keys());
  }

  /**
   * Sends Ctrl-C to the tmux session to interrupt Claude, then closes
   * the FIFO to ensure the pipeline (cat | claude) terminates cleanly.
   * Wrapper.sh will loop and wait for a new FIFO connection.
   *
   * After a delay, forces status back to idle and processes the queue
   * (since Claude may not emit a result frame after Ctrl-C).
   */
  async interrupt(sessionId: string): Promise<void> {
    await this.mux.sendInterrupt(sessionId);
    console.log(`[TmuxEngine] Sent interrupt to ${sessionId}`);

    // Close the FIFO to ensure clean pipeline termination.
    // This gives wrapper EOF → cat exits → Claude exits → wrapper loops.
    const fifo = this.fifos.get(sessionId);
    if (fifo) {
      try {
        fifo.close();
      } catch { /* already closed */ }
      this.fifos.delete(sessionId);
    }

    // Fallback: force idle after giving Claude time to exit
    setTimeout(async () => {
      const status = this.sessionStatus.get(sessionId);
      if (status === 'busy') {
        console.log(`[TmuxEngine] Interrupt fallback: forcing ${sessionId} to idle`);
        this.sessionStatus.set(sessionId, 'idle');
        this.busySince.delete(sessionId);
        const journal = await this.getJournal(sessionId);
        await journal.updateMetadata({ status: 'idle' });
        this.emit('status_change', { sessionId, status: 'idle' });
        // Process next queued input
        setTimeout(() => this.processNextInput(sessionId), 100);
      }
    }, 3000);
  }

  /**
   * Reconciles engine state with running tmux sessions after a server restart.
   * Re-opens FIFOs for alive sessions and kills orphaned tmux sessions.
   */
  async reconcile(): Promise<void> {
    const { alive, orphaned } = await this.mux.reconcileSessions(SESSIONS_BASE);

    for (const sessionId of alive) {
      try {
        const journal = await this.getJournal(sessionId);
        const meta = await journal.getMetadata();
        if (!meta) continue;

        // Reconnect FIFO to the existing tmux session
        await this.openFifo(sessionId);

        // Check for unprocessed inputs that were queued before shutdown
        const inputHistory = await journal.readInputHistory();
        const lastId = meta.lastProcessedInputId;
        const hasUnprocessed = lastId
          ? inputHistory.findIndex(e => e.id === lastId) < inputHistory.length - 1
          : inputHistory.length > 0;

        if (hasUnprocessed) {
          console.log(`[TmuxEngine] Reconcile: ${sessionId} has unprocessed inputs, processing...`);
          this.sessionStatus.set(sessionId, 'idle');
          await this.processNextInput(sessionId);
        } else {
          this.sessionStatus.set(sessionId, 'idle');
        }

        this.monitors.set(sessionId, { lastActivity: Date.now() });
        console.log(`[TmuxEngine] Reconciled session ${sessionId}`);
      } catch (err) {
        console.error(`[TmuxEngine] Failed to reconcile ${sessionId}:`, err);
      }
    }

    for (const sessionId of orphaned) {
      console.log(`[TmuxEngine] Killing orphaned tmux session: ${sessionId}`);
      await this.mux.killSession(sessionId);
    }

    console.log(`[TmuxEngine] Reconciliation complete: ${alive.length} alive, ${orphaned.length} orphaned`);
  }

  /**
   * Graceful shutdown. Closes all FIFOs (wrapper sees EOF, Claude exits).
   * Does NOT kill tmux sessions — they survive for reconnection.
   */
  stop(): void {
    if (this.reaperInterval) clearInterval(this.reaperInterval);

    // Kill all transform watchers
    for (const [id, watcher] of this.sessionWatchers.entries()) {
      try {
        watcher.process.kill('SIGTERM');
      } catch {
        /* already dead */
      }
    }
    this.sessionWatchers.clear();

    for (const [id, stream] of this.fifos.entries()) {
      try {
        stream.close();
      } catch {
        /* already closed */
      }
    }
    this.fifos.clear();
  }

  /**
   * Permanently destroys a session. Kills tmux, cleans up all state,
   * and optionally deletes session files from disk.
   */
  async destroy(sessionId: string, deleteFiles = false): Promise<void> {
    // 1. Close and remove FIFO write stream
    const fifo = this.fifos.get(sessionId);
    if (fifo) {
      try {
        fifo.close();
      } catch {
        /* already closed */
      }
      this.fifos.delete(sessionId);
    }

    // 2. Force-kill the transform watcher regardless of refCount
    const watcher = this.sessionWatchers.get(sessionId);
    if (watcher) {
      try {
        watcher.process.kill('SIGTERM');
      } catch {
        /* already dead */
      }
      this.sessionWatchers.delete(sessionId);
    }

    // 3. Kill the tmux session
    try {
      await this.mux.killSession(sessionId);
    } catch (err) {
      console.error(`[TmuxEngine] Failed to kill tmux session ${sessionId}:`, err);
    }

    // 4. Optionally delete session files
    if (deleteFiles) {
      const sessionDir = this.getSessionDir(sessionId);
      try {
        await fsPromises.rm(sessionDir, { recursive: true, force: true });
        console.log(`[TmuxEngine] Deleted session directory: ${sessionDir}`);
      } catch (err) {
        console.error(`[TmuxEngine] Failed to delete session dir ${sessionDir}:`, err);
      }
    }

    // 5. Clean up all maps
    this.journals.delete(sessionId);
    this.sessionStatus.delete(sessionId);
    this.monitors.delete(sessionId);
    this.pendingWakes.delete(sessionId);
    this.busySince.delete(sessionId);
    this.processingLock.delete(sessionId);

    console.log(`[TmuxEngine] Destroyed session ${sessionId} (deleteFiles=${deleteFiles})`);
  }

  // ── Private: FIFO & Process Management ────────────────

  /**
   * Ensures the tmux session is running and the FIFO is open for writing.
   * Deduplicates concurrent wake attempts via pendingWakes.
   */
  private async ensureAwake(sessionId: string): Promise<void> {
    if (this.fifos.has(sessionId)) return; // Already connected

    // Governance: enforce concurrent session limit
    if (this.fifos.size >= GOVERNANCE.MAX_CONCURRENT_SESSIONS) {
      // Try to hibernate the oldest idle session to make room
      const reaped = this.reapOldestIdle();
      if (!reaped) {
        throw new Error(`Session limit reached (${GOVERNANCE.MAX_CONCURRENT_SESSIONS} concurrent). All sessions are busy.`);
      }
    }

    if (this.pendingWakes.has(sessionId)) {
      await this.pendingWakes.get(sessionId);
      return;
    }

    const wakePromise = (async () => {
      try {
        const journal = await this.getJournal(sessionId);
        const meta = await journal.getMetadata();
        const projectPath = meta?.projectPath || process.cwd();
        const model = meta?.model || 'sonnet';
        const sessionDir = this.getSessionDir(sessionId);

        // Ensure tmux session exists (wrapper.sh creates FIFO and starts loop)
        const exists = await this.mux.sessionExists(sessionId);
        if (!exists) {
          console.log(`[TmuxEngine] Spawning tmux session for ${sessionId} (model=${model})`);
          await this.mux.createSession(sessionId, sessionDir, model, projectPath);
        } else {
          console.log(`[TmuxEngine] tmux session for ${sessionId} already alive, reconnecting FIFO`);
        }

        // Open FIFO — blocks until wrapper's `cat` opens the read end
        await this.openFifo(sessionId);

        this.sessionStatus.set(sessionId, 'idle');
        this.monitors.set(sessionId, { lastActivity: Date.now() });
        this.emit('status_change', { sessionId, status: 'idle' });

        console.log(`[TmuxEngine] Session ${sessionId} is awake`);
      } catch (err) {
        console.error(`[TmuxEngine] Failed to wake ${sessionId}:`, err);
        throw err;
      }
    })();

    this.pendingWakes.set(sessionId, wakePromise);
    try {
      await wakePromise;
    } finally {
      this.pendingWakes.delete(sessionId);
    }
  }

  /**
   * Opens the named FIFO for writing. This call blocks (via the 'open' event)
   * until a reader (wrapper.sh's `cat "$FIFO"`) opens the other end.
   * Times out after 10s if wrapper hasn't started yet.
   */
  private openFifo(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const fifoPath = this.getFifoPath(sessionId);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(new Error(`FIFO open timeout for ${sessionId} — wrapper may not be running`));
      }, 10000);

      const stream = fs.createWriteStream(fifoPath, { flags: 'w' });

      stream.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.fifos.set(sessionId, stream);

        // Handle FIFO errors (EPIPE if wrapper dies)
        // Only act if this stream is still the active one for this session —
        // a retry may have already replaced it.
        stream.on('error', (err) => {
          if (this.fifos.get(sessionId) !== stream) return; // stale stream, ignore
          console.error(`[TmuxEngine] FIFO error for ${sessionId}:`, err.message);
          this.fifos.delete(sessionId);
          this.sessionStatus.set(sessionId, 'sleeping');
          this.emit('status_change', { sessionId, status: 'sleeping' });
        });

        resolve();
      });

      stream.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // ── Private: Input Processing ─────────────────────────

  /**
   * Finds the next unprocessed input from in.jsonl and writes it to the FIFO.
   */
  private async processNextInput(sessionId: string): Promise<void> {
    if (this.processingLock.has(sessionId)) return;
    this.processingLock.add(sessionId);
    try {
      const journal = await this.getJournal(sessionId);
      const meta = await journal.getMetadata();
      const history = await journal.readInputHistory();

      // Find the next input after the last one we processed
      const lastId = meta?.lastProcessedInputId;
      let next: InputEntry | undefined;
      if (lastId) {
        const idx = history.findIndex(e => e.id === lastId);
        next = idx >= 0 ? history[idx + 1] : history[0];
      } else {
        next = history[0];
      }

      if (!next) return;

      await this.ensureAwake(sessionId);

      this.sessionStatus.set(sessionId, 'busy');
      this.busySince.set(sessionId, Date.now());
      this.emit('status_change', { sessionId, status: 'busy' });
      await journal.updateMetadata({ status: 'busy' });

      // Construct Claude JSON streaming input
      const claudeSessionId = meta?.claudeSessionId;
      const payload = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: next.text },
        session_id: claudeSessionId || 'default',
        parent_tool_use_id: null
      }) + '\n';

      const fifo = this.fifos.get(sessionId);
      if (fifo && !fifo.destroyed) {
        console.log(`[TmuxEngine] Writing to FIFO for ${sessionId}: "${next.text.substring(0, 80)}..."`);
        const writeSuccess = await new Promise<boolean>((resolve) => {
          fifo.write(payload, (err) => {
            if (err) {
              console.error(`[TmuxEngine] FIFO write error for ${sessionId}:`, err.message);
              resolve(false);
            } else {
              resolve(true);
            }
          });
        });

        if (writeSuccess) {
          await journal.updateMetadata({ lastProcessedInputId: next.id });
          this.monitors.set(sessionId, { lastActivity: Date.now() });
        } else {
          // EPIPE or similar — FIFO is broken (Claude was interrupted/killed).
          // Close old FIFO, reconnect, and retry.
          console.log(`[TmuxEngine] FIFO broken for ${sessionId}, reconnecting and retrying...`);
          this.fifos.delete(sessionId);
          try {
            fifo.destroy();
          } catch { /* already dead */ }

          // Re-open FIFO (blocks until wrapper's next `cat` opens the read end)
          await this.openFifo(sessionId);
          this.sessionStatus.set(sessionId, 'busy');
          this.emit('status_change', { sessionId, status: 'busy' });

          // Retry the write on the new FIFO
          const retryFifo = this.fifos.get(sessionId);
          if (retryFifo && !retryFifo.destroyed) {
            console.log(`[TmuxEngine] Retrying write to FIFO for ${sessionId}`);
            retryFifo.write(payload, (retryErr) => {
              if (retryErr) {
                console.error(`[TmuxEngine] FIFO retry write error for ${sessionId}:`, retryErr.message);
                this.fifos.delete(sessionId);
                this.sessionStatus.set(sessionId, 'sleeping');
                this.emit('status_change', { sessionId, status: 'sleeping' });
              }
            });
            await journal.updateMetadata({ lastProcessedInputId: next.id });
            this.monitors.set(sessionId, { lastActivity: Date.now() });
          }
        }
      } else {
        // No FIFO at all — re-wake the session
        console.log(`[TmuxEngine] FIFO not available for ${sessionId}, re-waking...`);
        this.fifos.delete(sessionId);
        await this.ensureAwake(sessionId);
        // Retry via recursive call (will find the same `next` since we didn't mark it processed)
        this.sessionStatus.set(sessionId, 'idle');
        setTimeout(() => this.processNextInput(sessionId), 100);
        return;
      }
    } catch (err) {
      console.error(`[TmuxEngine] processNextInput error for ${sessionId}:`, err);
      this.sessionStatus.set(sessionId, 'idle');
      this.emit('status_change', { sessionId, status: 'idle' });
    } finally {
      this.processingLock.delete(sessionId);
    }
  }

  // ── Private: Transform Watcher Lifecycle ──────────────

  /**
   * Ensures exactly ONE transform watcher exists per session.
   * The watcher tails out.jsonl for raw Claude frames and calls
   * transformClaudeFrame for each one. Multiple observers share
   * the same watcher via refCount.
   */
  private async ensureTransformWatcher(sessionId: string): Promise<void> {
    const existing = this.sessionWatchers.get(sessionId);
    if (existing) {
      existing.refCount++;
      return;
    }

    const journal = await this.getJournal(sessionId);
    const outPath = journal.getOutPath();

    const tailProc = spawn('tail', ['-f', '-n', '0', outPath]);
    const rl = readline.createInterface({ input: tailProc.stdout! });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const frame = JSON.parse(line);
        if (frame.type === 'stream_item') return; // Already transformed, skip
        this.transformClaudeFrame(frame, sessionId, journal);
      } catch {
        /* unparseable line — machine noise, skip */
      }
    });

    tailProc.on('exit', () => {
      rl.close();
      this.sessionWatchers.delete(sessionId);
    });

    this.sessionWatchers.set(sessionId, { process: tailProc, refCount: 1 });
  }

  /**
   * Decrements the refCount for a session's transform watcher.
   * Kills the watcher process when no observers remain.
   */
  private releaseTransformWatcher(sessionId: string): void {
    const watcher = this.sessionWatchers.get(sessionId);
    if (!watcher) return;

    watcher.refCount--;
    if (watcher.refCount <= 0) {
      watcher.process.kill('SIGTERM');
      this.sessionWatchers.delete(sessionId);
    }
  }

  // ── Private: Claude Frame Transformation ──────────────

  /**
   * Processes raw Claude NDJSON frames from out.jsonl.
   *
   * Responsibilities:
   *   - Capture Claude session ID from system.init
   *   - Transform assistant messages → stream_item frames (appended to out.jsonl)
   *   - Handle content_block_delta for streaming text
   *   - Detect turn completion (result/error) and manage status
   *
   * The transformed stream_items get picked up by the tail on the next
   * line read and forwarded to the WebSocket by the observer.
   */
  private async transformClaudeFrame(
    frame: any,
    sessionId: string,
    journal: JournalManager
  ): Promise<void> {
    try {
      const outPath = journal.getOutPath();

      // Capture Claude session ID from the init frame
      if (frame.type === 'system' && frame.subtype === 'init' && frame.session_id) {
        await journal.updateMetadata({ claudeSessionId: frame.session_id });
        // Write resume_id so wrapper.sh can resume on next loop iteration
        const resumePath = path.join(this.getSessionDir(sessionId), 'resume_id');
        await fsPromises.writeFile(resumePath, frame.session_id);
        console.log(`[TmuxEngine] Captured session ID for ${sessionId}: ${frame.session_id}`);
      }

      // Transform assistant messages into stream_items
      if (frame.type === 'assistant' && frame.message?.content) {
        const contents = Array.isArray(frame.message.content)
          ? frame.message.content
          : [frame.message.content];

        for (const block of contents) {
          if (block.type === 'text' && block.text) {
            let text: string = block.text;
            let notificationSubject: string | null = null;

            // Extract ::notify lines (last one wins)
            const notifyRegex = /^::notify\s+(.+)$/gm;
            let match;
            while ((match = notifyRegex.exec(text)) !== null) {
              notificationSubject = match[1].trim();
            }

            // Strip all ::notify lines from visible text
            const cleanText = text.replace(/^::notify\s+.+$/gm, '').trim();

            // Use cleaned text for assistant_message, fall back to subject if stripping left it empty
            const visibleText = cleanText || notificationSubject || '';

            const uiFrame = {
              type: 'stream_item',
              item: {
                kind: 'assistant_message',
                text: visibleText,
                id: crypto.randomBytes(3).toString('hex'),
                timestamp: new Date().toISOString()
              }
            };
            await fsPromises.appendFile(outPath, JSON.stringify(uiFrame) + '\n');

            // Write notification stream_item if present
            if (notificationSubject) {
              const notifFrame = {
                type: 'stream_item',
                item: {
                  kind: 'notification',
                  subject: notificationSubject,
                  id: crypto.randomBytes(3).toString('hex'),
                  timestamp: new Date().toISOString()
                }
              };
              await fsPromises.appendFile(outPath, JSON.stringify(notifFrame) + '\n');
            }
          } else if (block.type === 'thinking' && block.thinking) {
            const uiFrame = {
              type: 'stream_item',
              item: {
                kind: 'thought',
                text: block.thinking,
                id: crypto.randomBytes(3).toString('hex'),
                timestamp: new Date().toISOString(),
                status: 'ready'
              }
            };
            await fsPromises.appendFile(outPath, JSON.stringify(uiFrame) + '\n');
          } else if (block.type === 'tool_use' && block.id) {
            const uiFrame = {
              type: 'stream_item',
              item: {
                kind: 'tool_call',
                name: block.name || 'unknown',
                input: block.input ?? {},
                status: 'running',
                id: block.id,
                timestamp: new Date().toISOString()
              }
            };
            await fsPromises.appendFile(outPath, JSON.stringify(uiFrame) + '\n');
          }
        }
      }

      // Handle tool_result frames — these arrive as user-role messages from Claude CLI
      // containing tool_result content blocks. Each tool_result has a tool_use_id that
      // matches the original tool_use block's id, allowing the UI to correlate and update.
      if (frame.type === 'user' && frame.message?.content) {
        const contents = Array.isArray(frame.message.content)
          ? frame.message.content
          : [frame.message.content];

        for (const block of contents) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const isError = block.is_error === true;
            const resultContent = block.content;
            // Normalise result: if it's an array of content blocks, extract text
            let result: unknown = resultContent;
            if (Array.isArray(resultContent)) {
              const texts = resultContent
                .filter((b: any) => b.type === 'text' && b.text)
                .map((b: any) => b.text as string);
              result = texts.length === 1 ? texts[0] : texts.length > 1 ? texts.join('\n') : resultContent;
            }

            const uiFrame = {
              type: 'stream_item',
              item: {
                kind: 'tool_call',
                // name and input are unknown at this point; the UI merges by id so the
                // existing running entry keeps its name/input and only status/result update.
                name: '',
                input: {},
                result,
                status: isError ? 'failed' : 'completed',
                id: block.tool_use_id,
                timestamp: new Date().toISOString()
              }
            };
            await fsPromises.appendFile(outPath, JSON.stringify(uiFrame) + '\n');
          }
        }
      }

      // Handle streaming text deltas
      if (frame.type === 'content_block_delta' && frame.delta?.text) {
        const uiFrame = {
          type: 'stream_item',
          item: {
            kind: 'text_delta',
            text: frame.delta.text,
            id: 'delta',
            timestamp: new Date().toISOString()
          }
        };
        await fsPromises.appendFile(outPath, JSON.stringify(uiFrame) + '\n');
      }

      // Detect turn completion — transition back to idle and process queue
      if (
        frame.type === 'result' ||
        frame.type === 'error' ||
        (frame.type === 'system' && frame.subtype === 'error')
      ) {
        console.log(`[TmuxEngine] Turn complete for ${sessionId}`);
        this.sessionStatus.set(sessionId, 'idle');
        this.busySince.delete(sessionId);
        const observerCount = this.activeObservers.get(sessionId) || 0;
        const metaUpdate: Partial<import('./JournalManager.js').SessionMetadata> = { status: 'idle', lastResultAt: new Date().toISOString() };
        if (observerCount > 0) {
          metaUpdate.lastViewedAt = metaUpdate.lastResultAt;
        }
        await journal.updateMetadata(metaUpdate);
        this.emit('status_change', { sessionId, status: 'idle' });
        this.monitors.set(sessionId, { lastActivity: Date.now() });

        // First naming: after turn 2, if no title yet and not manually renamed
        if (!isManuallyRenamed(sessionId) && !getSessionTitle(sessionId)) {
          const history = await journal.readOutputHistory();
          const userTurns = history.filter(line => {
            try { const f = JSON.parse(line); return f.type === 'stream_item' && f.item?.kind === 'user_message'; } catch { return false; }
          }).length;
          if (userTurns >= 2) {
            this.autoNameSession(sessionId, journal).catch(() => {});
          }
        }

        // Process next queued input (with small delay to let state settle)
        setTimeout(() => this.processNextInput(sessionId), 100);
      }
    } catch (err) {
      console.error(`[TmuxEngine] transformClaudeFrame error for ${sessionId}:`, err);
    }
  }

  // ── Private: Auto-Naming ──────────────────────────────

  private static readonly NAMING_PROMPT =
    'Read the conversation and give it a short name — 2 to 4 words. The name should be how the person would refer to this work out loud to themselves. Think "That auth bug" not "Authentication Bug Fix." Think "Csv export" not "Implementing CSV Export Functionality." Be casual, first letter capital, all following lowercase, specific. Use the words the person actually used, not technical synonyms. If they said "that weird thing with the routes" the title is "weird routes thing." If the work is about a specific file, the filename might be the best title. Never use gerunds like "fixing" or "implementing." Never describe what the AI did. Name what the work is about.';

  private async autoNameSession(sessionId: string, journal: JournalManager): Promise<void> {
    try {
      const history = await journal.readOutputHistory();
      const lines: string[] = [];

      for (const line of history) {
        try {
          const frame = JSON.parse(line);
          if (frame.type === 'stream_item') {
            const { kind, text } = frame.item;
            if (kind === 'user_message' && text) lines.push(`USER: ${text}`);
            else if (kind === 'assistant_message' && text) lines.push(`ASSISTANT: ${text}`);
          }
        } catch { /* skip unparseable */ }
      }

      if (lines.length === 0) return;

      const transcript = lines.join('\n');
      const title = await executeOneShot({
        model: 'haiku',
        sterile: true,
        systemPrompt: TmuxSessionEngine.NAMING_PROMPT,
        prompt: transcript
      });

      const cleaned = title.trim();
      if (!cleaned || cleaned.length > 60) return;

      setSessionTitle(sessionId, cleaned);
      this.emit('chat_title_update', { sessionId, title: cleaned });
      console.log(`[TmuxEngine] Auto-named session ${sessionId}: "${cleaned}"`);
    } catch (err) {
      console.error(`[TmuxEngine] autoNameSession failed for ${sessionId}:`, err);
    }
  }

  // ── Private: Reaper ───────────────────────────────────

  /**
   * Closes a session's FIFO, transitioning it to sleeping state.
   * Claude gets EOF and exits; wrapper.sh loops and waits for reconnection.
   */
  private hibernate(sessionId: string): void {
    const fifo = this.fifos.get(sessionId);
    if (fifo) {
      console.log(`[TmuxEngine] Hibernating session: ${sessionId}`);
      try { fifo.close(); } catch { /* already closed */ }
      this.fifos.delete(sessionId);
      this.sessionStatus.set(sessionId, 'sleeping');
      this.emit('status_change', { sessionId, status: 'sleeping' });
    }
  }

  /**
   * Finds and hibernates the oldest idle session to free up a slot.
   * Returns true if a session was reaped, false if none are available.
   */
  private reapOldestIdle(): boolean {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, monitor] of this.monitors.entries()) {
      if (this.sessionStatus.get(id) === 'idle' && this.fifos.has(id)) {
        if (monitor.lastActivity < oldestTime) {
          oldestTime = monitor.lastActivity;
          oldestId = id;
        }
      }
    }
    if (oldestId) {
      this.hibernate(oldestId);
      return true;
    }
    return false;
  }

  /**
   * Periodically checks sessions and applies governance rules:
   *   1. Idle timeout — hibernate after 10 min of inactivity
   *   2. Orphan busy timeout — interrupt if busy >1hr with no observers
   *   3. (Future) Session TTL — hibernate sessions older than 4 hours
   */
  private startReaper(): void {
    this.reaperInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, monitor] of this.monitors.entries()) {
        const status = this.sessionStatus.get(id);

        // 1. Idle timeout — hibernate after 10 min of inactivity
        if (status === 'idle' && this.fifos.has(id) && now - monitor.lastActivity > GOVERNANCE.IDLE_REAP_MS) {
          this.hibernate(id);
          // Re-name on sleep (skip if manually renamed)
          if (!isManuallyRenamed(id)) {
            const journal = this.journals.get(id);
            if (journal) this.autoNameSession(id, journal).catch(() => {});
          }
          continue;
        }

        // 2. Orphan busy timeout — if busy for >1hr AND nobody watching, interrupt
        if (status === 'busy') {
          const busyStart = this.busySince.get(id);
          const observers = this.activeObservers.get(id) || 0;
          if (busyStart && observers === 0 && now - busyStart > GOVERNANCE.ORPHAN_BUSY_TIMEOUT_MS) {
            console.log(`[TmuxEngine] Orphan busy timeout: ${id} has been busy for ${Math.round((now - busyStart) / 60000)}min with 0 observers. Interrupting.`);
            this.interrupt(id).catch(err => console.error(`[TmuxEngine] Orphan interrupt failed for ${id}:`, err));
            // Write system message so it shows in the UI
            const journal = this.journals.get(id);
            if (journal) {
              const frame = JSON.stringify({
                type: 'stream_item',
                item: {
                  kind: 'system',
                  text: '[governance] Session interrupted: busy for over 1 hour with no active observers.',
                  timestamp: new Date().toISOString()
                }
              });
              journal.appendOutput(frame).catch(() => {});
            }
            continue;
          }
        }

        // 3. Session TTL — hibernate sessions older than 4 hours
        if (this.fifos.has(id)) {
          const journal = this.journals.get(id);
          if (journal) {
            journal.getMetadata().then(meta => {
              if (meta?.createdAt) {
                const age = now - new Date(meta.createdAt).getTime();
                if (age > GOVERNANCE.SESSION_TTL_MS) {
                  console.log(`[TmuxEngine] Session TTL expired: ${id} is ${Math.round(age / 3600000)}h old. Hibernating.`);
                  this.hibernate(id);
                }
              }
            }).catch(() => {});
          }
        }
      }
    }, GOVERNANCE.REAPER_INTERVAL_MS);
  }

  // ── Public: Governance & Diagnostics ──────────────────

  /**
   * Destroys all known sessions. Used for emergency cleanup.
   * Returns the list of session IDs that were destroyed.
   */
  async killAll(): Promise<string[]> {
    const killed: string[] = [];
    const allIds = [...new Set([...this.fifos.keys(), ...this.sessionStatus.keys(), ...this.monitors.keys()])];
    for (const id of allIds) {
      try {
        await this.destroy(id);
        killed.push(id);
      } catch (err) {
        console.error(`[TmuxEngine] killAll: failed to destroy ${id}:`, err);
      }
    }
    return killed;
  }

  /**
   * Returns a snapshot of the current system state for diagnostics.
   */
  getSystemStatus(): {
    sessions: Array<{ id: string; status: string; busyForMs?: number; observers: number }>;
    counts: { total: number; busy: number; idle: number; sleeping: number };
    fifoCount: number;
    governance: typeof GOVERNANCE;
  } {
    const sessions: Array<{ id: string; status: string; busyForMs?: number; observers: number }> = [];
    const allIds = [...new Set([...this.fifos.keys(), ...this.sessionStatus.keys(), ...this.monitors.keys()])];

    let busy = 0, idle = 0, sleeping = 0;
    for (const id of allIds) {
      const status = this.sessionStatus.get(id) || 'sleeping';
      const observers = this.activeObservers.get(id) || 0;
      const busyStart = this.busySince.get(id);
      const busyForMs = busyStart ? Date.now() - busyStart : undefined;
      sessions.push({ id, status, busyForMs, observers });
      if (status === 'busy') busy++;
      else if (status === 'idle') idle++;
      else sleeping++;
    }

    return {
      sessions,
      counts: { total: allIds.length, busy, idle, sleeping },
      fifoCount: this.fifos.size,
      governance: GOVERNANCE,
    };
  }
}
