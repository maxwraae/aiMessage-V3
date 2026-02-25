# Flow: Chat & Session Lifecycle

This document maps the exact sequence of logic for how aiMessage V3 manages Claude sessions, from discovery to real-time interaction.

---

## 1. The "Sidebar Discovery" Flow
**Goal:** Show a clean list of past human conversations in the sidebar.

1.  **Frontend (`App.tsx`):** Periodically polls `/api/projects` and `/api/projects/:key/sessions`.
2.  **Server (`server.ts`):** Receives the request and calls `listSessions(projectKey)`.
3.  **Discovery Logic (`session-discovery.ts`):**
    *   Scans the filesystem directory `~/.claude/projects/[projectKey]/`.
    *   For each `.jsonl` file found:
        *   **Check First Line:** If `isSidechain: true` is present, it immediately discards the file (filters out background processes).
        *   **Pattern Matching:** It imports `isNoise` from `shared/filter-config.ts`. It scans for the first "User" message that isn't blacklisted (e.g., skips "Memory Extraction").
        *   **Title Extraction:** If a valid human message is found, it crops it to 60 chars to create the sidebar title.
        *   **Junk Filter:** If no human message is found, the session is hidden entirely.
4.  **Result:** The sidebar displays a curated list of meaningful past interactions.

---

## 2. The "Resurrection" Flow (Resume + Hydration)
**Goal:** Open an old chat and see all past bubbles instantly.

1.  **Frontend (`App.tsx`):** User clicks a history item. Calls `POST /api/agents` with `{ resumeSessionId: "..." }`.
2.  **Server (`chat-agent.ts` -> `spawnChatAgent`):**
    *   **Pre-Hydration:** Before spawning any process, it calls `loadSessionHistory(projectPath, sessionId)`.
    *   **Direct File Read:** It manually reads the `.jsonl` file from `~/.claude/projects/`.
    *   **Filtering:** It parses the events, stripping out machine noise using `isNoise` and `isSidechain`.
    *   **History Snapshot:** It stores these "Human-Clean" messages in the `AgentEntry.history` array.
3.  **Process Spawn:** The server then spawns the real `claude` process using the `--resume` flag. This wakes up the model's memory, but the model *does not* re-print the history to stdout.
4.  **WebSocket Handshake:** The frontend connects to `/ws/chat/:agentId`.
5.  **Synchronization:** The server immediately emits a `history_snapshot` event containing the pre-loaded messages.
6.  **Result:** The user sees their entire past chat instantly, and Claude is ready to continue from exactly where it left off.

---

## 3. The "Headless Pipe" Flow (Live Chat)
**Goal:** Pure JSON communication between the user and Claude.

1.  **Frontend (`ChatView.tsx`):** User types a message and hits Enter.
2.  **Transmission:** The message is sent as a `user_input` JSON payload over the WebSocket.
3.  **Server (`chat-agent.ts` -> `sendMessage`):**
    *   Updates the local `agent.agentStatus` to `thinking`.
    *   Wraps the text into a strict NDJSON payload: `{"type": "user", "message": {"role": "user", "content": "..."}}`.
    *   Writes that single line + `
` directly to the `claudeProcess.stdin`.
4.  **Execution:** The headless Claude process processes the input and begins streaming events to its `stdout`.
5.  **Parsing:** The server reads `stdout` line-by-line using `readline`:
    *   **`text_delta`:** Forwarded to the UI for real-time typing.
    *   **`tool_use`:** Renders an expandable tool block in the chat.
    *   **`tool_result`:** Updates that same block with the output.
6.  **Error Handling:** Any data on `stderr` is captured, wrapped in a `system` item, and sent to the UI so the user sees technical warnings or crashes.

---

## 4. The "Sterile Whisper" Flow (Smart Naming)
**Goal:** Automatically turn "New Chat" into "weird routes thing" using Haiku.

1.  **Trigger:** The server monitors the `AgentEntry.history`. When the assistant finishes its first response, it triggers `triggerSmartNaming`.
2.  **Utility (`lib/claude-one-shot.ts`):** The server prepares a "Sterile" background call.
3.  **Bypass logic:**
    *   **Sterile Directory:** The command is executed from `/tmp/`. This forces Claude to ignore any `CLAUDE.md` or `MEMORY.md` in the actual project folder.
    *   **One-Shot Mode:** Uses `claude -p --model haiku --no-session-persistence`. This prevents the naming task from cluttering the project history.
4.  **The Prompt:** The server sends your naming philosophy (from `shared/filter-config.ts`) plus the first few messages of the chat.
5.  **Application:** When Haiku returns the 2-4 word string:
    *   The server updates `agent.title`.
    *   Emits a `chat_title_update` event.
6.  **Frontend:** `ChatView` receives the event and calls the `onTitleUpdate` callback, causing the sidebar to "pop" to the new smart name.

---

## File Map Reference

| Feature | Key Files |
| :--- | :--- |
| **Discovery** | `session-discovery.ts`, `shared/filter-config.ts` |
| **State Management** | `chat-agent.ts`, `server.ts` |
| **One-Shot API** | `lib/claude-one-shot.ts`, `shared/filter-config.ts` |
| **UI Components** | `client/App.tsx`, `client/components/ChatView.tsx` |
| **Protocol** | `shared/stream-types.ts` |
