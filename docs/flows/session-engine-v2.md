# Master Blueprint: Session Engine V2 (The "Journaled" Engine)

This document is the absolute source of truth for the aiMessage V2 Engine. It defines a "Journal-First" architecture that decouples the UI from the Agent process using a "Ghost in the Terminal" (tmux) model.

---

## 🏗 1. Core Architecture: "The Ghost & The Journal"

The Engine operates on three distinct layers to ensure 24/7 stability across restarts and multi-device synchronization.

### A. The "Ghost" (tmux Container)
- **Container:** Every session runs inside a detached `tmux` session named `aim-session-{id}`.
- **Immersion:** The process is "Immortal." It survives Node.js server restarts or browser refreshes.
- **Visibility:** Developers can `tmux attach -t aim-session-{id}` at any time to "peek" into the live brain for debugging.

### B. The "Journal" (Filesystem)
- **Source of Truth:** All data is stored in `~/.aimessage/sessions/{session_id}/`.
- **`in.jsonl` (Input):** Append-only record of all inputs (User, System, or Cron). 
  - *Format:* `{"id": "uuid", "clientId": "device-id", "type": "user", "text": "...", "timestamp": "ISO"}`
- **`out.jsonl` (Output):** Append-only record of every JSON frame produced by Claude.
  - *Format:* Raw JSON lines from Claude's `--output-format stream-json`.
- **`metadata.json`:** Stores the current state (`idle`, `busy`, `sleeping`), `projectPath`, and `activeModel`.

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
}
```

---

## 🔄 3. Logic Gates & State Machine

### A. The "Busy Lock" (Turn-Taking)
- **Rule:** Only one message is processed at a time.
- **Engagement:** When `in.jsonl` receives a new line, the Engine sets `metadata.status = 'busy'`.
- **Broadcasting:** All connected clients receive a `SESSION_LOCKED` message; UI disables input.
- **Release:** The lock is released only when the Claude JSON stream emits a `result` frame or the process exits.

### B. The "Shared Movie" (Catch-up)
- **Replay:** When a client connects, the Engine sends all lines from `out.jsonl`. 
- **Live Edge:** The client then transitions to "Listening" mode for new lines appended to the file.
- **Result:** Sync is 100% perfect across all devices.

### C. The "Reaper" (Hibernation)
- **Idle Timeout:** If no activity (input/output) occurs for 10 minutes, the Engine sends `SIGINT` to the tmux pane.
- **Hibernation:** The process exits, saving RAM. `metadata.status` is set to `sleeping`.
- **Wake:** The next `submit()` call transparently restarts the tmux session using `--resume`.

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
