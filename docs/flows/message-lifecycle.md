# Message Lifecycle

How a message travels from the user's keyboard to the UI and back.

---

## Storage Layout

Every session lives in two places:

```
~/.aimessage/sessions/{sessionId}/
  in.jsonl       — append-only input journal (user messages)
  out.jsonl      — dual-format journal (raw Claude NDJSON + stream_items, mixed)
  metadata.json  — session state (status, claudeSessionId, lastProcessedInputId)
  input.fifo     — named pipe: server writes, wrapper.sh reads
  resume_id      — Claude session UUID, written after first response
  err.log        — wrapper.sh stderr

~/.claude/projects/{encoded-project-path}/{claudeSessionId}.jsonl
  — Claude's own vault; source of truth for history hydration
```

`out.jsonl` is the central bus. It contains two kinds of lines in the same file:
- **Raw Claude NDJSON** — written directly by wrapper.sh's stdout redirect
- **`stream_item` frames** — written by the server (submit) or transform watcher

The two types are distinguished by `frame.type === 'stream_item'`. All downstream consumers filter on this.

---

## Flow 1: Sending a Message

**Starting state:** session is `idle`, FIFO is open, wrapper.sh is blocking on `cat input.fifo`.

```
1. User types in ChatView and hits send
   → WebSocket sends: { type: "user_input", text: "..." }

2. server.ts receives it
   → calls engine.submit(sessionId, clientId, text)

3. submit() [TmuxSessionEngine.ts:77]
   a. Appends entry to in.jsonl via journal.appendInput()
      — durable record; survives crashes and server restarts
   b. Writes a stream_item frame to out.jsonl immediately:
        { type: "stream_item", item: { kind: "user_message", text, id, timestamp } }
      — live tail picks this up and sends to WebSocket right away
      — user's own message appears in UI before Claude responds
   c. If session is busy or waking, returns here — input is queued in in.jsonl

4. processNextInput() [TmuxSessionEngine.ts:545]
   a. Reads in.jsonl, finds the next entry after lastProcessedInputId
   b. Calls ensureAwake() to verify FIFO is open (wakes if sleeping)
   c. Sets status to busy, emits status_change event
   d. Constructs Claude stream-json payload:
        { type: "user", message: { role: "user", content: text }, session_id: claudeSessionId }
   e. Writes payload to input.fifo [TmuxSessionEngine.ts:582]
   f. Updates metadata.lastProcessedInputId

5. wrapper.sh in tmux [wrapper.sh:44]
   — was blocking on: cat "$FIFO" | claude -p --input-format stream-json --output-format stream-json ...
   — FIFO receives data → cat reads it → pipes to Claude's stdin
   — Claude's stdout (raw NDJSON) appends to out.jsonl via >> redirection

6. Transform watcher [TmuxSessionEngine.ts:650]
   — a single tail -f -n 0 process on out.jsonl per session
   — sees new lines as they arrive
   — skips lines where frame.type === 'stream_item' (already processed)
   — calls transformClaudeFrame() for raw Claude frames:

     system.init frame
       → saves frame.session_id to metadata.json and to resume_id file

     assistant frame (type: "assistant", message.content[].type: "text")
       → appends stream_item: { kind: "assistant_message", text, id, timestamp }

     assistant frame (message.content[].type: "thinking")
       → appends stream_item: { kind: "thought", text, status: "ready", id, timestamp }

     content_block_delta frame (delta.text)
       → appends stream_item: { kind: "text_delta", text, id: "delta", timestamp }

     result or error frame
       → sets status to idle, emits status_change
       → calls processNextInput() after 100ms (drains the queue)

7. Live observer [TmuxSessionEngine.ts:216]
   — a separate tail -f -n 0 on out.jsonl per connected client
   — sees new lines as they arrive (including stream_items just written by transform watcher)
   — only forwards lines where frame.type === 'stream_item'
   — calls controller.enqueue(line) → WebSocket sends to browser

8. ChatView receives stream_item events
   — renders assistant_message, thought, text_delta, user_message as they arrive
```

**Note:** There is no in-memory event bus. The file IS the bus. Latency is write → tail picks it up → WebSocket send — milliseconds on local SSD, disk-bound not memory-bound.

---

## Flow 2: Client Connection and History Hydration

**What happens when a browser tab opens a session.**

```
1. Client opens WebSocket to /ws/chat/{sessionId}

2. server.ts calls engine.observe(sessionId, 0) [TmuxSessionEngine.ts:126]

3. observe() starts a ReadableStream:

   a. Hydration from Claude's vault [JournalManager.ts:139]
      — searches ~/.claude/projects/ for the encoded project path
      — reads {claudeSessionId}.jsonl from Claude's own vault
      — reads current out.jsonl to get existing item IDs (dedup set)
      — for each vault entry not already in out.jsonl:
          user entries    → stream_item: { kind: "user_message" }
          assistant text  → stream_item: { kind: "assistant_message" }
          thinking blocks → stream_item: { kind: "thought" }
          tool_use blocks → stream_item: { kind: "tool_call" }
        appends new stream_items to out.jsonl
      — hydration is incremental: only new items imported, never duplicated
      — subsequent connects rerun this but import nothing (all IDs already known)

   b. Calls ensureAwake() — opens FIFO if session is sleeping

   c. Starts 10-second periodic re-hydration loop
      (picks up any vault activity from other clients or direct Claude use)

   d. Sends agent_status to client: { type: "agent_status", status: "idle"|"thinking" }

   e. Reads entire out.jsonl via journal.readOutputHistory() [TmuxSessionEngine.ts:200]
      — filters for stream_item frames only (raw Claude frames are invisible)
      — sends history_snapshot: { type: "history_snapshot", items: [...] }

   f. Starts live tail -f -n 0 on out.jsonl [TmuxSessionEngine.ts:216]
      — forwards only stream_item frames
      — history_snapshot was sent first, so no duplication

4. Client renders snapshot immediately, applies live events on top
```

---

## Flow 3: Session Lifecycle

Sessions have three states. Transitions are emitted as `status_change` events and forwarded to connected clients as `agent_status` messages.

```
sleeping
  — FIFO closed (or not yet opened)
  — tmux session is alive; wrapper.sh is blocking on: cat input.fifo
  — Claude process not running

idle
  — FIFO open (server has a write stream to input.fifo)
  — Claude process running inside wrapper.sh
  — ready to receive input

busy
  — FIFO has been written; Claude is processing
  — transform watcher reading output, appending stream_items

sleeping → idle:   ensureAwake() opens the FIFO; wrapper.sh's cat unblocks
idle → busy:       processNextInput() writes to FIFO
busy → idle:       transformClaudeFrame() sees result/error frame; calls processNextInput() for queue
idle → sleeping:   reaper fires after 10 minutes of inactivity; closes FIFO
                   Claude gets EOF → exits → wrapper.sh loops → blocks on cat again
```

**Server restart reconciliation** [TmuxSessionEngine.ts:317]:
- On startup, engine.reconcile() checks which tmux sessions are still alive
- For alive sessions: re-opens the FIFO, resumes processing any queued inputs
- For orphaned sessions (tmux gone): kills them
- Sessions survive server restarts because tmux and wrapper.sh run independently

---

## Flow 4: Interrupting Claude

```
1. Client sends { type: "interrupt" } over WebSocket

2. server.ts calls engine.interrupt(sessionId) [TmuxSessionEngine.ts:284]

3. interrupt():
   a. Sends Ctrl-C to the tmux session (SIGINT to the cat|claude pipeline)
   b. Closes the FIFO write stream
      — wrapper.sh's cat gets EOF → exits → Claude process exits
      — wrapper.sh loops, waits for next FIFO open

4. wrapper.sh writes a system marker to out.jsonl:
     { type: "stream_item", item: { kind: "system", text: "[wrapper] Claude process exited..." } }

5. Fallback: if status is still busy after 3 seconds, force to idle and drain queue
```

---

## Two Tail Processes Per Session

When a client is connected, two separate `tail -f` processes watch `out.jsonl`:

| Process | Purpose | Filters |
|---|---|---|
| Transform watcher | Converts raw Claude NDJSON → stream_items, appends to out.jsonl | Skips stream_items, processes everything else |
| Live observer (per client) | Forwards stream_items to WebSocket | Only forwards stream_items, skips raw frames |

The transform watcher is shared across clients (refCount). The live observer is per-client, created in observe() and killed on disconnect.

Both start with `-n 0` (tail from current end only), so they never see historical content — that's handled by the history snapshot.
