# Chat & Session Lifecycle

This document maps the exact flow for how **aiMessage V3** manages Claude sessions — from discovery to resurrection to live interaction.

> **Note:** This document is integrated with [Unified Session Management](./session-management.md). The distinction between "Active" and "History" is deprecated in favor of a single **Power State** model.

---

## Overview: The Four Core Flows

aiMessage V3 orchestrates four distinct interaction patterns:

1. **Unified Sidebar** — Discover and display all conversations
2. **Resurrection** — Resume old chats with full history hydration
3. **Headless Pipe** — Live, streaming communication with Claude
4. **Sterile Whisper** — Smart, automatic conversation naming

Each flow is designed to feel instant, natural, and invisible to the user.

---

## 1. Unified Sidebar Flow

**Experience Goal:** *A single, persistent list where conversations "wake up" when you need them.*

### The User Experience

When you open aiMessage, you see all your conversations — past and present. Cold sessions appear dimmed and resting. Active sessions glow with vibrancy. There's no "archive" or "history" tab. Everything exists in one seamless list.

### The Technical Flow

```
Frontend (App.tsx)
    ↓ Periodically polls
/api/sessions endpoint
    ↓ Returns
Session Discovery Engine
    ↓ Scans filesystem
~/.claude/projects/[projectKey]/*.jsonl
    ↓ Filters & analyzes
Curated Conversation List
```

### Discovery Logic (`session-discovery.ts`)

**What it does:**
1. **Scans** the filesystem for all `.jsonl` session files
2. **Filters** out noise using intelligent pattern matching:
   - Checks first line for `isSidechain: true` (background processes)
   - Uses `isNoise` from `shared/filter-config.ts` to skip system messages
   - Ignores sessions with no human interaction (e.g., "Memory Extraction")
3. **Extracts** the first meaningful user message
4. **Creates** a title by cropping to 60 characters
5. **Hides** junk sessions with no valid human messages

### The Result

A clean, intelligent sidebar that shows only meaningful conversations — automatically curated without manual organization.

### State Visualization

**Cold Session (Dimmed):**
```
💬 weird routes thing
   Last active: 2 hours ago
   ━━━━━━━━━━━━━━━━━━━━ (subtle, low opacity)
```

**Warm Session (Vibrant):**
```
💬 Swift concurrency help
   Active now
   ━━━━━━━━━━━━━━━━━━━━ (glowing, full color)
```

---

## 2. Resurrection Flow (Resume + Hydration)

**Experience Goal:** *Click an old conversation and see your entire history instantly — no loading, no delay.*

### The User Experience

You scroll through your sidebar and spot a conversation from yesterday. One click, and the entire chat appears immediately — every message, every response, perfectly preserved. Claude picks up exactly where you left off, memory intact.

It feels like magic. But it's actually a carefully orchestrated dance.

### The Technical Flow

```
User clicks history item
    ↓
POST /api/agents { resumeSessionId: "..." }
    ↓
Pre-Hydration Phase (Before spawning process)
    ↓
loadSessionHistory(projectPath, sessionId)
    ↓ Direct file read
~/.claude/projects/[project]/[session].jsonl
    ↓ Parse & filter
Human-Clean Messages (no noise, no sidechain)
    ↓ Store in memory
AgentEntry.history[] array
    ↓
Spawn Claude Process (with --resume flag)
    ↓ Model wakes up with memory
No re-printing to stdout (already cached)
    ↓
WebSocket connects: /ws/chat/:agentId
    ↓ Immediate emit
history_snapshot event → Frontend
    ↓
Full chat appears instantly
```

### Key Implementation Details

**Pre-Hydration (`chat-agent.ts` → `spawnChatAgent`):**
- Reads the `.jsonl` file **before** spawning any process
- Parses events and strips machine noise using `isNoise` and `isSidechain`
- Creates a clean "human-readable" message array
- Stores in `AgentEntry.history`

**Process Spawn:**
- Uses `--resume` flag to wake Claude's memory
- Model has full context but doesn't re-emit history
- Ready to continue immediately

**Synchronization:**
- Frontend connects via WebSocket
- Server sends `history_snapshot` event instantly
- UI hydrates with full conversation history

### The Result

**Perceived Performance:**
- **0ms** — History appears (from cache)
- **~200ms** — Claude is ready to respond
- **∞** — Conversations never die, just sleep

This creates the illusion that conversations are always "warm" and waiting for you.

---

## 3. Headless Pipe Flow (Live Chat)

**Experience Goal:** *Pure, real-time conversation with zero friction.*

### The User Experience

You type. You hit Enter. Words appear instantly as Claude thinks out loud. Tools run. Results stream in. It feels like talking to a person — immediate, fluid, natural.

Under the hood, it's a high-speed JSON pipeline optimized for minimal latency.

### The Technical Flow

```
User types message in ChatView.tsx
    ↓ Enter key
WebSocket: user_input JSON payload
    ↓
Server (chat-agent.ts → sendMessage)
    ↓ Updates status
agent.agentStatus = "thinking"
    ↓ Wraps as NDJSON
{"type": "user", "message": {"role": "user", "content": "..."}}
    ↓ Writes to stdin
claudeProcess.stdin.write(payload + "\n")
    ↓
Headless Claude Process
    ↓ Processes & streams to stdout
Line-by-line events via readline
    ↓ Parser routes events
Stream Handler
    ├─ text_delta → Real-time typing to UI
    ├─ tool_use → Expandable tool block
    ├─ tool_result → Updates tool block with output
    └─ stderr → System warnings/errors to UI
```

### Event Types & User Experience

| Event | What User Sees | Feel |
| :--- | :--- | :--- |
| `text_delta` | Characters appearing in real-time | Like watching someone type |
| `tool_use` | Collapsible tool block with name | Transparency into agent thinking |
| `tool_result` | Block expands with output | Immediate feedback |
| `stderr` | System message (red/yellow) | Technical visibility when needed |

### Communication Protocol

**User Input (to Claude):**
```json
{"type": "user", "message": {"role": "user", "content": "How do I use async/await?"}}
```

**Claude Output (to UI):**
```json
{"type": "text_delta", "delta": "Async/await in Swift..."}
{"type": "tool_use", "name": "read_file", "input": {...}}
{"type": "tool_result", "content": "...file contents..."}
```

### Error Handling Philosophy

**Principle:** Never hide technical details. Users should see exactly what's happening.

- `stderr` messages are captured and displayed as system events
- Process crashes are wrapped and shown inline
- Network errors get clear, actionable messages

### The Result

**Latency Profile:**
- **~10-50ms** — Message received by server
- **~100-300ms** — First `text_delta` appears
- **~0ms** — Each subsequent character (streamed)

The conversation feels **synchronous** even though it's streaming over WebSockets.

---

## 4. Sterile Whisper Flow (Smart Naming)

**Experience Goal:** *Conversations name themselves intelligently without you lifting a finger.*

### The User Experience

You start a new chat. It says "New Chat" at first. You ask a question. Claude responds. Then — seamlessly, silently — the title transforms into something meaningful: "weird routes thing" or "Swift concurrency help."

You never had to think about naming. It just... knew.

### The Technical Flow

```
User sends first message
    ↓
Claude responds
    ↓ Trigger condition met
Server monitors AgentEntry.history
    ↓ First response complete
triggerSmartNaming()
    ↓
Background One-Shot Process (lib/claude-one-shot.ts)
    ↓ Sterile environment
Executes from /tmp/ (bypasses project context)
    ↓ Minimal model
claude -p --model haiku --no-session-persistence
    ↓ Naming prompt
Philosophy + First few messages → Haiku
    ↓ Returns
2-4 word title string
    ↓ Updates
agent.title in memory
    ↓ Emits
chat_title_update event → WebSocket
    ↓
Sidebar "pops" to new name
```

### The Sterile Environment

**Why "Sterile"?**

The naming task must be isolated from the actual conversation:
- **Different directory**: Executes from `/tmp/` to bypass `CLAUDE.md` and `MEMORY.md`
- **No persistence**: Uses `--no-session-persistence` flag to avoid polluting project history
- **Fast model**: Uses Haiku for sub-second responses
- **One-shot**: Single prompt-response cycle, then process terminates

### Naming Philosophy

The prompt includes your naming philosophy from `shared/filter-config.ts`:

> "Create a 2-4 word title that captures the essence of this conversation. Be specific but concise. Use lowercase. No quotes. Examples: 'weird routes thing', 'Swift concurrency help', 'database migration fix'"

### The Flow Timeline

```
0ms     — User message sent
1500ms  — Claude finishes first response
1501ms  — Smart naming triggered
1800ms  — Haiku returns title
1801ms  — Title update emitted
1802ms  — Sidebar updates with animation
```

**Perceived experience:** Title appears ~300ms after Claude's first response — fast enough to feel instant, but not so fast it feels jarring.

### Visual Feedback

**Before:**
```
💬 New Chat
   Just now
```

**After (with subtle pop animation):**
```
💬 Swift concurrency help
   Just now
   ✨ (brief sparkle/highlight)
```

### The Result

Conversations are **self-documenting**. You never waste mental energy on naming. The system intelligently captures the essence of each interaction and presents it naturally — like a good assistant who just knows what you need.

---

---

## Design Principles

### 1. **Invisible Orchestration**
The user should never *feel* the system working. Conversations wake up instantly. Names appear automatically. History loads seamlessly. Technical complexity is hidden behind simple, natural interactions.

### 2. **Always Warm**
There's no concept of "closed" or "archived" conversations. Everything is just sleeping, ready to wake up the moment you need it. This creates a sense of continuity and permanence.

### 3. **Radical Transparency**
When things *do* break, show everything. `stderr` messages, process crashes, network errors — all visible. Users should never wonder "what's happening?"

### 4. **Zero Manual Labor**
The system should name itself, organize itself, and clean itself up. Users focus on conversations, not file management.

### 5. **Instant Feedback**
Every action has immediate visual response:
- Message sent → Instant "thinking" state
- History clicked → Instant conversation load
- Title updated → Subtle animation highlight
- Error occurred → Clear, actionable message

---

## File Map Reference

Everything connects. Here's where each piece lives:
| Feature | Implementation Files | Purpose |
| :--- | :--- | :--- |
| **Discovery** | `session-discovery.ts`<br>`shared/filter-config.ts` | Find and curate conversations |
| **State Management** | `chat-agent.ts`<br>`server.ts` | Track all active/cold sessions |
| **One-Shot API** | `lib/claude-one-shot.ts`<br>`shared/filter-config.ts` | Sterile background tasks |
| **UI Components** | `client/App.tsx`<br>`client/components/ChatView.tsx` | Visual presentation layer |
| **Protocol** | `shared/stream-types.ts` | WebSocket event definitions |
| **Hydration** | `chat-agent.ts → loadSessionHistory()` | Pre-load conversation history |
| **Streaming** | `chat-agent.ts → readline handlers` | Parse real-time Claude output |

---

## User Experience Touchpoints

### Visual States

**Session Power States:**
- 🔵 **Warm** (Active): Full color, glowing indicator
- ⚪ **Cold** (Sleeping): Dimmed, low opacity
- 🟡 **Thinking**: Pulsing animation
- 🔴 **Error**: Red indicator with error message

**Message States:**
- ✍️ **Typing**: Animated dots or streaming text
- 🔧 **Tool Running**: Expandable block with spinner
- ✅ **Complete**: Static, readable message
- ⚠️ **Error**: System message with details

**Title States:**
- 📝 **New Chat**: Default placeholder
- ✨ **Naming...**: Brief loading state (optional)
- 💬 **Named**: Smart title with subtle highlight animation

### Interaction Patterns

**Click Patterns:**
- **Single click** on session → Open/resume conversation
- **Long press/right-click** on session → Context menu (rename, delete, archive)
- **Click** on tool block → Expand/collapse details
- **Click** on error → Copy error details

**Keyboard Shortcuts:**
- `Cmd+N` → New conversation in current project
- `Cmd+K` → Quick search/switch conversations
- `Enter` → Send message
- `Shift+Enter` → New line in input
- `Cmd+/` → Show all shortcuts

---

## Performance Expectations

### Loading Times
| Action | Target | Acceptable | User Perception |
| :--- | :--- | :--- | :--- |
| Open cold session | <100ms | <300ms | Instant |
| History hydration | <50ms | <150ms | Immediate |
| First text delta | <200ms | <500ms | Fast |
| Title generation | <500ms | <1000ms | Background magic |
| Session discovery | <100ms | <300ms | Always ready |

### Animation Durations
| Animation | Duration | Curve | Purpose |
| :--- | :--- | :--- | :--- |
| Message appear | 300ms | `spring(0.3, 0.7)` | Natural entry |
| Title update | 200ms | `ease-out` | Subtle highlight |
| Status change | 150ms | `ease-in-out` | Clear feedback |
| Sidebar select | 100ms | `linear` | Immediate response |
| Thinking pulse | 1200ms | `ease-in-out` | Calming rhythm |

---

## Edge Cases & Polish

### Empty States
- **No conversations yet**: Welcoming message with "Start a new chat" button
- **No projects**: Onboarding flow to create first project
- **All sessions cold**: Clear visual hierarchy, most recent at top

### Error Recovery
- **Process crash**: Show error, offer "Restart" button
- **Network timeout**: Retry automatically, show retry count
- **File read error**: Fall back gracefully, log details
- **Invalid session**: Hide from sidebar, log warning

### Loading States
- **Discovery scanning**: Subtle progress indicator (optional)
- **History loading**: Skeleton UI or instant fade-in
- **Title generating**: No loading state (happens in background)
- **Message sending**: Optimistic UI (show immediately, confirm on ack)

### Accessibility
- **Screen reader**: Full VoiceOver/NVDA support for all states
- **Keyboard nav**: Every action accessible via keyboard
- **Reduce motion**: Respect system setting, use simpler transitions
- **High contrast**: Color states remain distinguishable

---

*This document describes not just what the system does, but how it should **feel** to use it. Every technical decision serves the goal of creating a conversation experience that feels natural, instant, and effortless.*

