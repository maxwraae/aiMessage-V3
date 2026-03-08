import type { ChatMessage, ChatSession } from "../types/chat";

const messages: ChatMessage[] = [
  {
    id: "1",
    kind: "user",
    text: "We need to move the session store from in-memory to something persistent. What are the real tradeoffs between SQLite and Postgres for this?",
    timestamp: Date.now() - 600000,
  },
  {
    id: "2",
    kind: "agent",
    whisper: "read session-store.ts, server.ts, JournalManager.ts · searched \"better-sqlite3\", \"pg\"",
    text: `## The Core Question

This isn't really a database choice — it's an operational complexity decision. Both SQLite and Postgres can store session data reliably. The question is where you want the complexity to live: in your deployment, or in your application code.

**SQLite** gives you zero operational overhead. No daemon, no connection pooling, no separate backup strategy. The database is a single file sitting next to your application. For a session store on a single-server deployment like this one (served over Tailscale, running on your Mac), that's a genuine advantage. You \`cp\` the file to back it up. You \`ls -la\` it to check its size. There's no mystery.

The tradeoff is concurrency. SQLite uses file-level locking in WAL mode, which means you get concurrent reads but writes are serialized. For a session store where writes are "create session" and "update last-active timestamp," this is fine — you'd need hundreds of concurrent writes per second before it matters. But if you later want to run multiple server processes, SQLite becomes a bottleneck you have to architect around.

**Postgres** gives you real concurrency, row-level locking, and a query planner that handles complex access patterns without thinking. It also gives you \`LISTEN/NOTIFY\` for free, which is interesting if you ever want cross-process session events. The cost is operational: you're running a daemon, managing connections, handling migrations with a proper tool, and your backup strategy involves \`pg_dump\` or WAL archiving instead of \`cp\`.

## My Recommendation

For this project, **start with SQLite via \`better-sqlite3\`**. Here's why:

- **Single server deployment.** You're running on one Mac, accessed over Tailscale. There's no multi-node story here, and adding one prematurely would be overengineering.
- **Write patterns are light.** Session creation, status updates, metadata writes. This is maybe 10-20 writes per minute at peak. SQLite in WAL mode handles thousands per second.
- **Migration path is clean.** If you outgrow SQLite, the schema translates directly to Postgres. The queries are standard SQL. You'd swap the driver and connection logic, not rewrite your data layer.
- **Operational simplicity compounds.** Every piece of infrastructure you don't run is a piece that can't break at 2am. The session store is not where you want operational excitement.

The one thing I'd do from the start is **put a thin repository abstraction over the database calls** — not a full ORM, just a \`SessionStore\` interface with \`create\`, \`get\`, \`update\`, \`list\` methods. That way the Postgres migration, if it ever happens, is a single file swap rather than a grep-and-replace across the codebase.`,
    timestamp: Date.now() - 590000,
  },
  {
    id: "2b",
    kind: "tool_call",
    name: "Edit",
    input: {
      file_path: "src/engine-v2/session-store.ts",
      old_string: "const sessions = new Map<string, Session>();",
      new_string: "import Database from 'better-sqlite3';\nconst db = new Database('./sessions.db');",
    },
    result: "Edit applied successfully.",
    status: "completed" as const,
    timestamp: Date.now() - 500000,
  },
  {
    id: "2c",
    kind: "tool_call",
    name: "Bash",
    input: { command: "npm test -- --grep 'session store'" },
    result: "PASS src/__tests__/session-store.test.ts\n  SessionStore\n    \u2713 creates a session (3ms)\n    \u2713 persists across restarts (12ms)\n    \u2713 handles concurrent writes (8ms)\n\n3 tests passed",
    status: "completed" as const,
    timestamp: Date.now() - 495000,
  },
  {
    id: "2d",
    kind: "tool_call",
    name: "Agent",
    input: {
      description: "Research better-sqlite3 WAL mode config",
      subagent_type: "research",
      prompt: "Find best practices for better-sqlite3 WAL mode configuration in production Node.js apps",
    },
    status: "running" as const,
    timestamp: Date.now() - 490000,
  },
  {
    id: "3",
    kind: "user",
    text: "Good call. Sketch out what the schema and repository interface would look like.",
    timestamp: Date.now() - 400000,
  },
  {
    id: "4",
    kind: "agent",
    whisper: "read types.ts, stream-types.ts · glob \"**/session*.ts\"",
    text: `## Schema

Two tables. A \`sessions\` table as the primary entity, and a \`messages\` table that's append-only and keyed to a session. Keeping it minimal — only store what the application actually queries.

The \`sessions\` table has \`id\`, \`name\`, \`project_id\`, \`status\`, \`model\`, \`created_at\`, and \`updated_at\`. The \`messages\` table has \`id\`, \`session_id\` (foreign key), \`kind\`, \`content\` (JSON blob), \`timestamp\`, and \`created_at\`. One index on \`(session_id, timestamp)\` for fast message retrieval.

The \`content\` column is a JSON blob rather than normalized columns, because message shapes vary by kind — user messages have optional images and files, agent messages are just text, tool traces have nested arrays. SQLite's \`json_extract()\` handles the occasional query into message content cleanly enough.

The \`updated_at\` on sessions gets bumped on every status change and every new message. This gives you a single column to sort by for "most recently active" without scanning the messages table.

## Repository Interface

A \`SessionStore\` interface with the basics: \`create\`, \`get\`, \`list\`, \`updateStatus\`, \`updateName\`, \`delete\` for sessions. For messages: \`appendMessage\` and \`getMessages\` with a timestamp cursor for pagination. Plus a \`close\` method for cleanup.

The interface is deliberately boring. No fancy query builders, no reactive subscriptions, no batch operations beyond what you need today. The \`getMessages\` cursor is timestamp-based because that's how the UI consumes them — "give me everything after what I've already rendered."

**One implementation detail worth calling out:** \`better-sqlite3\` is synchronous, which is actually an advantage here. No async/await ceremony, no connection pool management, no promise chains. You call a function, you get data back. For a single-server application, synchronous SQLite is faster and simpler than any async database driver.`,
    timestamp: Date.now() - 390000,
  },
  {
    id: "4b",
    kind: "image",
    uri: "https://placehold.co/800x420/1c1c1e/666?text=JSONL+Journal+Structure",
    width: 800,
    height: 420,
    caption: "Current journal file layout in ~/.aimessage/sessions/",
    timestamp: Date.now() - 380000,
  },
  {
    id: "4c",
    kind: "file",
    name: "session-store-benchmarks.md",
    size: "4.2 KB",
    timestamp: Date.now() - 370000,
  },
  {
    id: "5",
    kind: "user",
    text: "What about migrating the existing JSONL journal files? There's real session history in those.",
    timestamp: Date.now() - 200000,
  },
  {
    id: "6",
    kind: "agent",
    whisper: "read JournalManager.ts, metadata.json · glob \"~/.aimessage/sessions/*\"",
    text: `## Migration Strategy

The existing journals at \`~/.aimessage/sessions/{id}/\` are straightforward to migrate. Each session directory contains three files: \`metadata.json\` (session config), \`in.jsonl\` (user inputs), and \`out.jsonl\` (Claude outputs). The migration is a one-time script that reads these files and inserts rows into the new schema.

Here's the approach:

**Phase 1 — Parallel operation.** Deploy the new SQLite store alongside the existing JSONL journals. New sessions write to both. This gives you a rollback path: if something goes wrong with SQLite, the JSONL files are still there and the engine can fall back to them. Run this for a week.

**Phase 2 — Backfill.** Run a migration script that walks \`~/.aimessage/sessions/\`, reads each session's metadata and journal files, and inserts them into SQLite. The script should be idempotent — running it twice produces the same result, so you don't have to worry about partial runs or duplicates. For each session directory, read the metadata, create the session row, then parse both JSONL files, interleave by timestamp, and insert as messages.

**Phase 3 — Cut over.** Once you've verified the SQLite data matches the journals (spot-check a few sessions, compare message counts), stop writing to JSONL. Keep the old files around for a month, then archive them to the NAS.

The one subtlety is **timestamp ordering**. The JSONL files don't have perfectly synchronized clocks — \`in.jsonl\` and \`out.jsonl\` are written by different parts of the system. When interleaving, sort by timestamp but don't panic if a response appears to precede its prompt by a few milliseconds. The UI already handles this gracefully because it renders messages in array order, not strict timestamp order.

**Total effort estimate:** The migration script is maybe 80 lines of code. The parallel-write phase is a small change to \`JournalManager\` — add a \`this.store.appendMessage()\` call next to the existing \`appendFile()\` call. The whole thing can ship incrementally across three PRs over a week, with zero downtime and a clean rollback at every stage.`,
    timestamp: Date.now() - 190000,
  },
];

export const mockSession: ChatSession = {
  id: "session-001",
  name: "Session store migration: SQLite vs Postgres",
  status: "idle",
  messages,
};
