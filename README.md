# aiMessage V3: Pure Data Architecture

aiMessage V3 is a "Headless" UI wrapper around **Claude Code**. It transforms the Claude CLI from a terminal application into a structured data engine, allowing for a modern, multi-agent chat interface.

---

## 🏗 The Architecture: "Pure Data, No Bullshit"

Unlike standard terminal wrappers that use `node-pty`, aiMessage V3 uses Claude Code's **Headless Mode**. This bypasses the ANSI-heavy terminal UI (`Ink`) and creates a pure JSON pipe.

### 1. The Pipe (Stdout/Stdin)
- **Spawn:** We launch Claude with `-p --input-format stream-json --output-format stream-json`.
- **Input:** We send Newline Delimited JSON (NDJSON) to `stdin`.
- **Output:** We parse raw NDJSON from `stdout`, extracting events like `text_delta`, `thought`, and `tool_use`.
- **System Noise:** `stderr` is captured and rendered as "System" items, ensuring no error or tool warning is silently swallowed.

### 2. The "One-Shot" Utility (`lib/claude-one-shot.ts`)
We use a special trick to perform "API-like" tasks (like naming chats or summarizing) using your **Claude Pro Subscription** instead of expensive API credits.
- **Sterile Mode:** The utility runs `claude -p` from the `/tmp` directory.
- **Bypass Logic:** By running in `/tmp`, Claude ignores the project's `CLAUDE.md` and `MEMORY.md`, providing a fast, blank-slate response.
- **Use Case:** Every new chat is automatically named using a background **Haiku** process that analyzes the first 3 messages.

### 3. History Hydration
When you resume a session, the CLI does not re-print past messages.
- **Direct Access:** The server locates the project's history in `~/.claude/projects/`.
- **Pre-Hydration:** We parse the `.jsonl` session log and send it to the frontend *before* the process even starts. This makes "Resuming" feel instantaneous.

### 4. Transparent Noise Filtering (`shared/filter-config.ts`)
Claude Code generates a lot of "mechanical noise" (e.g., Memory Extraction sidechains).
- **The Filter:** We maintain a central blacklist of patterns (like "Create these memory entities").
- **Double-Scrub:** Noise is filtered both from the **Sidebar** (session discovery) and the **Chat Bubbles** (live events).

---

## 🚦 Multi-Agent Monitoring

The system is designed to handle multiple active Claude processes simultaneously.

- **Thinking States:** The sidebar shows an **Amber Pulsing Dot** when an agent is generating text or running a tool.
- **Unread Badges:** If Claude responds while you are looking at a different chat, a **Red Badge** tracks how many messages you've missed.
- **Attention Reset:** Clicking a chat automatically clears the unread count on the server.

---

## 🚀 Development

### Tech Stack
- **Frontend:** React + Vite + Tailwind (Vanilla CSS for components).
- **Backend:** Node.js + WebSockets (`ws`).
- **Protocol:** Pure NDJSON proxying.

### Configuration
If you want to hide new types of machine noise, simply add the pattern to:
`shared/filter-config.ts`

### Running the App
```bash
npm run dev   # Starts Vite and the Node server in watch mode
npm run build # Compiles the project into the /dist folder
npm start     # Runs the production server
```

---

*This architecture was built to solve the "split-brain" problem of mixing terminal UI with machine-readable data. It treats Claude as a data engine first, and a chat partner second.*
