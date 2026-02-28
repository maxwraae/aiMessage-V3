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

const SESSIONS_BASE = path.join(os.homedir(), '.aimessage', 'sessions');

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
  private reaperInterval: NodeJS.Timeout | null = null;

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
    await journal.updateMetadata({ sessionId, projectPath, model, status: 'sleeping' });
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
    };

    return new ReadableStream({
      async start(controller) {
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
   * Returns current session metadata with live status overlay.
   */
  async getState(sessionId: string): Promise<SessionMetadata | null> {
    const journal = await this.getJournal(sessionId);
    const meta = await journal.getMetadata();
    if (meta) {
      const status = this.sessionStatus.get(sessionId);
      if (status) meta.status = status;
    }
    return meta;
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

    console.log(`[TmuxEngine] Destroyed session ${sessionId} (deleteFiles=${deleteFiles})`);
  }

  // ── Private: FIFO & Process Management ────────────────

  /**
   * Ensures the tmux session is running and the FIFO is open for writing.
   * Deduplicates concurrent wake attempts via pendingWakes.
   */
  private async ensureAwake(sessionId: string): Promise<void> {
    if (this.fifos.has(sessionId)) return; // Already connected
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
            const uiFrame = {
              type: 'stream_item',
              item: {
                kind: 'assistant_message',
                text: block.text,
                id: crypto.randomBytes(3).toString('hex'),
                timestamp: new Date().toISOString()
              }
            };
            await fsPromises.appendFile(outPath, JSON.stringify(uiFrame) + '\n');
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
        await journal.updateMetadata({ status: 'idle' });
        this.emit('status_change', { sessionId, status: 'idle' });
        this.monitors.set(sessionId, { lastActivity: Date.now() });

        // Process next queued input (with small delay to let state settle)
        setTimeout(() => this.processNextInput(sessionId), 100);
      }
    } catch (err) {
      console.error(`[TmuxEngine] transformClaudeFrame error for ${sessionId}:`, err);
    }
  }

  // ── Private: Reaper ───────────────────────────────────

  /**
   * Periodically checks for idle sessions (10min no activity) and hibernates
   * them by closing the FIFO. This causes Claude to get EOF and exit, but the
   * tmux session stays alive — wrapper.sh loops and waits for the next FIFO open.
   */
  private startReaper(): void {
    this.reaperInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, monitor] of this.monitors.entries()) {
        if (now - monitor.lastActivity > 10 * 60 * 1000) {
          const fifo = this.fifos.get(id);
          if (fifo) {
            console.log(`[TmuxEngine] Hibernating idle session: ${id}`);
            try {
              fifo.close();
            } catch {
              /* already closed */
            }
            this.fifos.delete(id);
            this.sessionStatus.set(id, 'sleeping');
            this.emit('status_change', { sessionId: id, status: 'sleeping' });
          }
        }
      }
    }, 60000);
  }
}
