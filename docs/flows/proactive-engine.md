# Proactive Engine

How sessions wake up on their own, do work, and leave a trail.

Three components. Each is simple. They feed each other.

---

## The Activity Log

A single SQLite database that captures what every session did, in one or two sentences per entry. The punchline, not the conversation.

```
~/.aimessage/activity.db
```

### Schema

```sql
CREATE TABLE activity (
  id      INTEGER PRIMARY KEY,
  ts      INTEGER NOT NULL,      -- unix ms
  type    TEXT NOT NULL,         -- message | heartbeat | scheduled | background | system
  project TEXT,                  -- claude project key (slug from ~/.claude/projects/)
  session TEXT,                  -- session id if applicable
  summary TEXT NOT NULL          -- haiku-generated, 1-2 sentences
);

CREATE INDEX idx_ts          ON activity(ts DESC);
CREATE INDEX idx_type_ts     ON activity(type, ts DESC);
CREATE INDEX idx_project_ts  ON activity(project, ts DESC);
```

Example entries:

```
ts: 2026-02-28T08:15  type: scheduled   project: aiMessage-V3   summary: Morning briefing. 3 meetings today, PR review pending on atlas.
ts: 2026-02-28T09:30  type: message     project: aiMessage-V3   summary: Fixed transform bug in TmuxSessionEngine. Added destroy(). 7/8 tests pass.
ts: 2026-02-28T14:22  type: heartbeat   project: aiMessage-V3   summary: checked, nothing to report
ts: 2026-02-28T15:45  type: heartbeat   project: aiMessage-V3   summary: reminded Max to send Henrik draft (created 6 hours ago)
```

### Why SQLite, not a flat file

Filtering is a query, not a grep. "What did the heartbeat do this week?" is one indexed read. "What happened in the atlas project today?" is one indexed read. At thousands of entries a flat file is fine. At millions it's a file scan. SQLite handles both, costs nothing extra, and is still a single local file.

### Filtering

```sql
-- Heartbeat: what have I checked recently in this project?
SELECT summary FROM activity
WHERE type = 'heartbeat' AND project = :project
ORDER BY ts DESC LIMIT 20;

-- Full project picture
SELECT * FROM activity
WHERE project = :project
ORDER BY ts DESC LIMIT 50;

-- Everything today, all projects
SELECT * FROM activity
WHERE ts > :startOfDay
ORDER BY ts DESC;

-- Cross-project: what did scheduled jobs do this week?
SELECT * FROM activity
WHERE type = 'scheduled' AND ts > :oneWeekAgo
ORDER BY ts DESC;
```

This is how agents read it: each context (heartbeat, session, scheduler) queries with the filter that makes sense for its job.

**Project field:** comes from `~/.claude/projects/` — Claude's native vault, source of truth. Key is the directory slug (e.g. `-Users-maxwraae-projects-aiMessage-V3`). Display names/aliases live in `~/.claude/aimessage-metadata.json`. Log stores the key; UI renders the alias.

### How entries get written

```
1. TmuxSessionEngine emits status_change: busy → idle

2. A 2-minute debounce timer starts
   — if the session goes busy again within 2 minutes, timer resets
   — prevents chatty back-and-forth from spamming the log

3. After 2 minutes of idle, the summarizer fires:

   a. Read metadata.json to get lastSummarizedLine (byte offset or line count)
   b. Read out.jsonl from that offset to end
      — filter for stream_item frames only
      — extract user_message and assistant_message text
      — cap at last ~4000 chars (enough context, not the whole conversation)
   c. Fire a one-shot:

      executeOneShot({
        model: 'haiku',
        sterile: true,
        prompt: `Summarize what was accomplished in this conversation in 1-2 lines.
                 Just the outcome. No filler. No "the user asked..." framing.

                 ${conversationTail}`
      })

   d. Insert into activity.db:
        { ts, type: 'message', project: projectKey, session: sessionId, summary: haikuSummary }
   e. Update metadata.json: lastSummarizedLine = current end of out.jsonl

4. If the session goes busy → idle again later, only the NEW portion
   (since lastSummarizedLine) gets summarized. No double-counting.
```

### What makes this cheap

- Haiku is the cheapest model
- Sterile mode: runs from /tmp, no CLAUDE.md, no tools, no session
- Input is ~4000 chars of conversation tail. Output is 1-2 lines. Maybe 600 tokens total.
- Fires once per "conversation chunk," not per message. Maybe 10-20 per day.
- Uses `executeOneShot()` which hits Pro subscription, not API credits [lib/claude-one-shot.ts]

### Scale

Each entry is one row. 20 entries per day = 7,300 rows/year. Queries are sub-millisecond with the indexes. No rotation needed.

---

## The Heartbeat

A timer in the server that periodically asks: "Is anything worth acting on right now?"

The heartbeat does NOT run inside a session. It runs a cheap one-shot that reads context, makes a judgment call, and either does nothing or wakes a real session.

### The timer loop

```
server.ts startup:
  setInterval(heartbeatTick, 60_000)  // Check every 60 seconds

heartbeatTick():
  1. Load heartbeat config from ~/.aimessage/heartbeat.json
  2. Check: is now >= nextRunAt?
     — if no: return (nothing due)
  3. Check: is current time within active hours?
     — default: 07:00 - 23:00
     — if outside: return (quiet hours)
  4. Run the heartbeat one-shot (see below)
  5. Compute nextRunAt from interval (e.g. now + 30 minutes)
  6. Persist nextRunAt to heartbeat.json
```

### The heartbeat one-shot

```
const todaysActivity = queryActivity({ since: startOfDay, project, limit: 100 })

const result = await executeOneShot({
  model: 'haiku',
  sterile: true,
  prompt: `You are Max's assistant. Current time: ${now}.

           Here is what happened today:
           ${todaysActivity}

           ${heartbeatInstructions}

           If nothing needs attention, reply exactly: HEARTBEAT_OK
           Otherwise, state what needs attention and why, in 2-3 sentences.`
})
```

`heartbeatInstructions` comes from a file, like OpenClaw's HEARTBEAT.md. Could live at `~/.aimessage/heartbeat-prompt.md`. This is where you write standing orders:

```
Check if any drafted emails haven't been sent after 4+ hours.
Check if there's a meeting in the next 30 minutes I should prepare for.
Check if any background agents finished with errors.
```

The instructions are just a text file. Edit it anytime. Next tick picks up the changes.

### What happens with the result

```
if result === "HEARTBEAT_OK":
  → Insert into activity.db:
      { type: 'heartbeat', project, summary: 'checked, nothing to report' }
  No notification. No session wake. Just the record.

else:
  → Insert into activity.db:
      { type: 'heartbeat', project, summary: result }
  → Send notification (terminal notifier, push, etc.)
  → Optionally: wake a real session via sendInput() if the alert
     requires action, not just awareness
```

Every heartbeat tick is logged, including silent ones. The activity log is where the system's self-awareness lives — if a tick leaves no trace, there's no way to know the system is actually running.

### Cost

48 one-shots per day (every 30 min, 16 active hours). Each is ~500 tokens. Negligible.

---

## Scheduled Tasks

Specific things that should happen at specific times. Unlike the heartbeat (which evaluates and decides), scheduled tasks are direct: "At 8am, do this."

### Config

```json
// ~/.aimessage/schedule.json
{
  "jobs": [
    {
      "id": "morning-briefing",
      "cron": "0 8 * * *",
      "sessionId": "jarvis-main",
      "prompt": "Morning briefing. Check calendar, reminders due today, and yesterday's unfinished activity.",
      "source": "scheduled"
    },
    {
      "id": "pr-check",
      "cron": "0 10,14 * * 1-5",
      "sessionId": "dev-agent",
      "prompt": "Check for open PRs that need review.",
      "source": "scheduled"
    }
  ]
}
```

### Execution

```
The same 60-second timer that runs heartbeatTick also checks scheduled jobs:

schedulerTick():
  1. Load schedule.json
  2. For each job: is now >= nextRunAt (computed from cron expression)?
  3. If due:
     a. Call engine.sendInput(job.sessionId, job.prompt, 'scheduler')
        — this is the same sendInput() the browser uses
        — the message enters the queue, gets written to FIFO
        — Claude wakes up in the tmux session, full project context
        — the response flows through the normal pipeline (transform watcher, out.jsonl)
     b. Mark the input as source: 'scheduled' in in.jsonl
        — frontend can filter/style these differently
     c. Compute nextRunAt from cron expression, persist to schedule.json
  4. When the session goes idle after processing:
     — activity logger fires as normal
     — entry tagged [scheduled] in the log
```

### Two modes

**Session task** (like the examples above): sends a message to an existing session. The agent has full context, project files, conversation history. Good for recurring work that builds on prior context.

**Isolated task** (fire and forget): creates a temporary session, sends the prompt, waits for completion, captures the output, destroys the session. Good for one-off checks that don't need persistent context.

```json
{
  "id": "weekly-review",
  "cron": "0 18 * * 5",
  "isolated": true,
  "projectPath": "/tmp/jarvis-weekly",
  "prompt": "Review this week's activity log and write a summary.",
  "source": "scheduled"
}
```

For isolated tasks:
```
1. engine.createSession(job.projectPath, 'haiku')
2. engine.sendInput(sessionId, job.prompt, 'scheduler')
3. Wait for idle status
4. Read the response from out.jsonl
5. Route output (save to file, notification, etc.)
6. engine.destroy(sessionId, true)
```

---

## How They Feed Each Other

```
                    ┌─────────────────────┐
                    │   Activity Log      │
                    │  ~/.aimessage/      │
                    │   activity.db       │
                    └──────▲──────┬───────┘
                           │      │
              writes       │      │ reads today's entries
              punchlines   │      │
                           │      ▼
┌──────────────────┐      │   ┌──────────────────┐
│  Sessions        │──────┘   │  Heartbeat       │
│  (tmux agents)   │◄────────│  (haiku one-shot) │
│                  │  wakes   │  every 30 min     │
│  busy → idle     │  via     └──────────────────┘
│  triggers        │  sendInput()
│  summarizer      │          ┌──────────────────┐
│                  │◄────────│  Scheduler        │
│                  │  wakes   │  (cron jobs)      │
│                  │  via     │  from schedule.json│
└──────────────────┘  sendInput()  └──────────────────┘
```

1. **Sessions do work** (user-initiated or triggered by heartbeat/scheduler)
2. **Activity logger** captures what was done (haiku one-shot, 2-min debounce)
3. **Heartbeat** reads today's log, decides if follow-up needed
4. If yes, heartbeat **wakes a session** via sendInput()
5. That session does work, which the logger captures... and the loop continues

Each component is independent. They don't call each other directly. The activity log file is the shared state. The heartbeat reads it. The logger writes it. The scheduler ignores it (it's time-based, not event-based).

---

## Frontend Implications

The frontend doesn't need to know about the heartbeat or scheduler directly. Everything flows through the same pipeline:

- Scheduled messages appear as `user_message` stream_items in out.jsonl
- They carry a `source: 'scheduled'` tag (or the clientId is 'scheduler')
- The frontend can filter, collapse, or style these differently
- Heartbeat alerts that wake a session look like any other message

The only new UI consideration: a way to show/hide automated messages. A toggle in the session header, or a filter in the sidebar. "Show background activity" on/off.

---

## Files

| File | Purpose |
|------|---------|
| `~/.aimessage/activity.db` | SQLite activity log. Indexed by ts, type, project. |
| `~/.aimessage/heartbeat.json` | Heartbeat config: interval, active hours, nextRunAt |
| `~/.aimessage/heartbeat-prompt.md` | Standing instructions for what to check. Plain text. |
| `~/.aimessage/schedule.json` | Cron job definitions |
| `lib/claude-one-shot.ts` | Existing. Runs haiku one-shots via CLI subscription. |
| `server.ts` | Timer loop lives here. 60-second setInterval. |
| `src/engine-v2/TmuxSessionEngine.ts` | Existing. status_change events trigger the activity logger. sendInput() used by scheduler. |

---

## What This Doesn't Do (Yet)

- **No output routing beyond notifications.** When a scheduled task produces output and no browser is connected, the response sits in out.jsonl. A future version could email it, save to Obsidian, or push to Telegram.
- **No error backoff.** If a scheduled task fails, it'll fire again next cycle. OpenClaw has exponential backoff (30s → 1m → 5m → 15m → 1hr). Worth adding when this runs in production.
- **No web UI for schedule management.** Edit schedule.json and heartbeat-prompt.md directly. A management UI can come later.
- **No multi-machine coordination.** This assumes one server. If aiMessage runs on both MacBook and Mac Mini, the activity log and schedule would need to be shared or synced.
