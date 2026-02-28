# Master Blueprint: Session Engine V2 (The "Journaled" Engine)

This document is the absolute source of truth for the aiMessage V2 Engine. It defines a "Journal-First" architecture that decouples the UI from the Agent process using a "Ghost in the Terminal" (tmux) model.

---

## 🏗 1. Core Architecture: "The Ghost & The Journal"

The Engine operates on three distinct layers to ensure 24/7 stability across restarts and multi-device synchronization.

### A. The "Ghost" (tmux Container)
- **Container:** Every session runs inside a detached `tmux` session named `aim-session-{id}`.
- **Binary:** `/Users/maxwraae/.local/bin/claude`.
- **Arguments:** `-p --input-format stream-json --output-format stream-json --resume {session_id} --model {model}`.
- **Persistence:** If the Node server dies, `tmux` keeps the process alive. `reconcile()` finds sessions via `tmux ls -F "#{session_name}"`.

### B. The "Journal" (Filesystem)
- **Workspace:** `~/.aimessage/sessions/{session_id}/`.
- **`in.jsonl` (Input):** Sequential record. **Append-only.**
- **`out.jsonl` (Output):** Captured via `tmux pipe-pane -t {name} "cat >> {path}"`.
- **`metadata.json`:** Tracks `lastProcessedInputId` to ensure no message is double-sent or skipped during a wake-up.

### C. The "Intercom" (Broadcast Layer)
- **Single Producer:** One Claude process per session.
- **Multiple Consumers:** Any number of WebSockets (Phone, Desktop) "tail" the `out.jsonl` simultaneously.
- **Replay Logic:** New connections read from `offset: 0` to catch up on the "movie" instantly.

---

## 🛠 2. The Engine API (The "Black Box")

The Engine must be implemented as a standalone module with zero UI dependencies.

```typescript
interface SessionEngine {
  // Input: Appends to in.jsonl and triggers the Wake/Pipe logic
  submit(sessionId: string, clientId: string, text: string): Promise<void>;
  
  // Output: Returns a stream that tails out.jsonl in real-time
  observe(sessionId: string, offset: number): ReadableStream;
  
  // Lifecycle: Reconciles running tmux sessions with the filesystem on boot
  reconcile(): Promise<void>;
  
  // State: Returns the current Busy Lock status and metadata
  getState(sessionId: string): SessionMetadata;

  // NEW: The "Emergency Brake"
  interrupt(sessionId: string): Promise<void>;

  // NEW: Clean cleanup on server exit
  stop(): Promise<void>;
}
```

---

## 🔄 3. Logic Gates & State Machine

### A. The "Busy Lock" (Turn-Taking)
- **Lock Engagement:** Triggered when the Engine pipes a JSON block into Claude's `stdin`.
- **Lock Release (The Monitor):** The Engine tails `out.jsonl` and looks for **specific JSON types**:
  - `type: "result"` (Success)
  - `type: "error"` (CLI/API Failure)
  - `type: "system", subtype: "error"` (Crash)
- **Turn Sequence:** `submit` -> `busy` -> `monitor out.jsonl` -> `detect result` -> `idle` -> `process next`.

### B. The "Shared Movie" (Catch-up)
- **Replay:** When a client connects, the Engine sends all lines from `out.jsonl`. 
- **Live Edge:** The client then transitions to "Listening" mode for new lines appended to the file.
- **Result:** Sync is 100% perfect across all devices.

### C. The "Reaper" (Hibernation)
- **Idle Timeout:** If no activity (input/output) occurs for 10 minutes, the Engine sends `SIGINT` to the tmux pane.
- **Hibernation:** The process exits, saving RAM. `metadata.status` is set to `sleeping`.
- **Wake:** The next `submit()` call transparently restarts the tmux session using `--resume`.

### D. Environment Injection (The "Key" Gate)
- **Problem:** Background terminals often lose shell environment variables.
- **Solution:** On `createSession`, the Engine MUST execute:
  `tmux set-env -t {id} ANTHROPIC_API_KEY {key}`
  `tmux set-env -t {id} PATH {path}`
- **Requirement:** This ensures Claude always has the credentials and tools it needs to run.

### E. The "Interrupt" Flow (User Override)
1. **User Trigger:** User clicks "Stop" or "Cancel" in the UI.
2. **Signal:** Engine sends `tmux send-keys -t {id} C-c`.
3. **Recovery:** The Busy Lock is forcefully released, and the Engine returns to `idle`.

---

## 🚀 4. Implementation Plan: The 4-Layer Build Order

We rebuild the engine from the bottom up in a dedicated sanctuary: `src/engine-v2/`.

### Layer 1: The Journal (`JournalManager.ts`)
- **Goal:** Robust file I/O for `.jsonl` files.
- **Verification:** CLI script can append lines from 3 concurrent "pseudo-clients" without corruption.

### Layer 2: The Muxer (`MuxManager.ts`)
- **Goal:** Control tmux via shell commands (`new-session`, `send-keys`, `kill-session`).
- **Verification:** CLI script can create a session, "send-keys" to it, and "re-find" it by PID after the script restarts.

### Layer 3: The Brain (`SessionEngine.ts`)
- **Goal:** The "Smart Layer" linking Journals to the Muxer.
- **Logic:** Watch `in.jsonl` -> Wake tmux -> Pipe input -> Tail output to `out.jsonl` -> Release Lock.
- **Verification:** The "CLI Stress Test": Send a message, kill the test script mid-thought, restart it, and see if the output stream continues seamlessly.

### Layer 4: The Integration
- **Goal:** Replace `chat-agent.ts` with the new Engine.
- **Dumb Server:** `server.ts` now only calls `engine.submit()` and `engine.observe()`.
- **Dumb UI:** React components only listen for `isBusy` and render the incoming stream.

---

## 🧪 5. Verification Checklist (Definition of Done)

1. [ ] **Stability:** Killing the Node server does NOT kill the Claude process.
2. [ ] **Persistence:** Re-opening the app shows the "Thinking" process exactly where it left off.
3. [ ] **Multi-Client:** Typing on a phone immediately locks the input on the desktop.
4. [ ] **Hibernation:** Idle sessions exit automatically and resume in <2s on new input.
5. [ ] **Clean Data:** No terminal ANSI codes in the UI; 100% pure JSON parsing.

---

## 🔬 6. Hardened Test Suite (The "Stress Test" script)

We will build `src/engine-v2/stress-test.ts`. This script will execute the following 5 "Phase Tests" and must return a 100% pass rate before integration.

### Phase 1: The "New & Resume" Lifecycle
- **Step 1:** Call `engine.submit(id, 'c1', 'echo "First"')`. Verify `tmux` spawns.
- **Step 2:** Call `mux.killSession(id)`.
- **Step 3:** Call `engine.submit(id, 'c1', 'echo "Second"')`.
- **Step 4:** Read `out.jsonl`. Verify it contains BOTH "First" and "Second" outputs.
- **Goal:** Prove the Engine handles the death and resurrection of the agent without losing the "Movie."

### Phase 2: The "Shared Movie" (Late-Joiner Sync)
- **Step 1:** Start a session. Pipe a stream of numbers 1-50 (1 per 100ms) into the journal.
- **Step 2:** Client A connects at `offset 0`.
- **Step 3:** When Journal hits 25 lines, Client B connects at `offset 0`.
- **Assertion:** By the time the stream hits 50, both Client A and Client B must have identical 50-line buffers.
- **Goal:** Prove that `observe(sessionId, 0)` correctly replays history before transitioning to live streaming.

### Phase 3: The "Busy Lock" (Input Integrity)
- **Step 1:** Send a long-running command (e.g., `sleep 5 && echo "done"`).
- **Step 2:** While the session is `busy`, attempt to `engine.submit()` a second message.
- **Assertion:** The second message must be written to `in.jsonl` but NOT piped to `tmux` until the first message finishes.
- **Goal:** Prove the engine can't be "confused" by multiple devices talking at once.

### Phase 4: The "5-Second Reaper" (Hibernation)
- **Config:** Set `IDLE_TIMEOUT = 5000`.
- **Step 1:** Send a message. Wait 6 seconds.
- **Assertion:** `tmux has-session` must fail. `metadata.status` must be `sleeping`.
- **Step 2:** Send a new message.
- **Assertion:** `tmux has-session` must succeed immediately.
- **Goal:** Prove the engine saves RAM automatically without user intervention.

### Phase 5: The "Claude Audit" (1:1 Verification)
- **Step 1:** Run a real Claude turn: `engine.submit(id, 'c1', 'Write a 3-word poem')`.
- **Step 2:** Wait for `type: "result"` in `out.jsonl`.
- **Step 3:** Locate Claude's internal file: `~/.claude/projects/RELEVANT_SLUG/{session_id}.jsonl`.
- **Assertion:** Perform a line-by-line comparison. Our `out.jsonl` must contain every JSON frame present in Claude's official record.
- **Goal:** Prove the "Glass Office" is a 100% faithful witness to the Claude CLI.

---

## 🔍 7. Verification Method
1.  **Shell Escaping:** Every `tmux` command MUST use `'` (single quote) wrapping. Any internal single quotes must be escaped as `'\\''`.
2.  **Line Buffering:** `tail -f` output must be parsed line-by-line using a proper `readline` interface to prevent JSON fragmentation.
3.  **Atomic Metadata:** `metadata.json` updates must be atomic (Write-to-Temp -> Rename) to prevent corruption during a server crash.
4.  **Graceful Shutdown:** The Node process should listen for `SIGTERM`/`SIGINT` and call `engine.stop()`, which sends a `SIGINT` to all active agents to let them save their SQLite history before the server dies.
