# Surface: Implementation Plan

Engineering plan for building the Surface UI. Read `DESIGN_V2.md` first for the full design spec, visual language, and interaction model. This document is the build sequence.

**Reference mockups** (in this folder):
- `Home base.png` — Clean Home view: greeting on fog gradient, minimal. The target feeling.
- `Home view with shelves.png` — Home with project shelf cards, "Today" / "Yesterday" grouping. Shows the card-on-fog layout.
- `Another home view with shelves.png` — Alternate shelf layout with "Spaces" and "Items" sections. Shows horizontal item scroll pattern.
- `project view.png` — Project interior: thread list on left, content area on right, search bar at top. The target layout.
- `White multi chat view.png` — Two cards side-by-side on fog. Focus mode reference (post-V1).
- `Focus mode.png` — Same, on device frame with depth fog behind cards.
- `Black chat view.png` — Single card on dark background. Immersive chat reference (post-V1, no dark mode in V1).

---

## What stays, what's new

**Stays untouched:**
- `server.ts` — all REST endpoints and WebSocket handler
- `src/engine-v2/` — TmuxSessionEngine, JournalManager, MuxManager, wrapper.sh
- `shared/stream-types.ts` — the WebSocket protocol
- `shared/filter-config.ts` — noise filtering
- `lib/claude-one-shot.ts` — Haiku one-shots for naming/summaries
- `vite.config.ts` — output stays `dist/`, just change root from `client` to `client` (same)

**Archived:**
- `client/` → rename to `client-v1/` for reference. The battle-tested rendering logic lives here. Port from it, don't rewrite from scratch.

**New:**
- Fresh `client/` directory — React 19 + Framer Motion + Tailwind v4

**Server additions (Stage 3):**
- Thread CRUD endpoints (small, extends existing metadata pattern)

---

## File structure

```
client/
  index.html
  main.tsx
  App.tsx                          # View router (Home ↔ Project), global state
  index.css                        # Tailwind v4 + fog + typography tokens

  views/
    HomeView.tsx                   # Greeting + pulse + surface cards + project shelf
    ProjectView.tsx                # Thread list + focused chat

  components/
    ChatCard.tsx                   # The universal component. Header + messages + input.
    ProjectCard.tsx                # Project shelf card (portal view)
    ThreadList.tsx                 # Thread sidebar with status dots
    FloatingBar.tsx                # Glass pill: search + action button
    StatusDot.tsx                  # 8px blue/amber dot

    chat/                          # Ported + refactored from client-v1/ChatView.tsx
      MessageBubble.tsx            # User message: gray bg, images, file chips
      AgentMessage.tsx             # Agent text: raw ReactMarkdown on canvas
      TracePill.tsx                # Grouped tool traces (Read, Glob, Grep...)
      PromotedPill.tsx             # Expanded tool calls (Edit, Bash, Write...)
      CodeBlock.tsx                # Fenced code with copy button
      InputBar.tsx                 # Textarea + send + voice + file attach
      ThinkingCanvas.tsx           # Animated blob background when agent is working

  hooks/
    useWebSocket.ts                # Connect to /ws/chat/{sessionId}
    useStreamItems.ts              # Process stream items + group messages
    useProjects.ts                 # GET /api/projects, polling or event-driven
    useThreads.ts                  # Thread CRUD (create, list, add session)
    useSessions.ts                 # Session listing + live status
    useVoice.ts                    # MediaRecorder → POST /api/transcribe
    useNavigation.ts               # View stack + Framer Motion transitions

  lib/
    api.ts                         # REST API client (typed fetch wrappers)
    groupMessages.ts               # Port from ChatView.tsx groupMessages()
    classifyTool.ts                # Port from ChatView.tsx classifyTool()

  types/
    index.ts                       # UI-specific types (views, navigation, threads)
```

---

## Stage 1: Foundation

**Goal:** Fog on screen. Build tooling works. Server serves the new client.

### Setup
- [ ] Rename `client/` → `client-v1/` (keep for porting reference)
- [ ] Create fresh `client/` directory
- [ ] `client/index.html` — minimal HTML shell, mount point `#root`
- [ ] `client/main.tsx` — React 19 `createRoot`, render `<App />`
- [ ] `client/App.tsx` — skeleton: renders fog background, greeting text
- [ ] Verify `vite.config.ts` still works (root: `client`, output: `dist/`)

### Fog + Typography
- [ ] `client/index.css`:
  - Import Tailwind v4 (`@import "tailwindcss"`)
  - Define fog gradient as CSS custom property:
    ```css
    --fog: linear-gradient(135deg,
      hsl(240, 10%, 94%) 0%,
      hsl(350, 12%, 93%) 50%,
      hsl(30, 14%, 93%) 100%);
    ```
  - Typography tokens as custom properties (sizes, weights, opacities from DESIGN_V2 table)
  - `--color-blue: #007AFF` (needs you)
  - `--color-amber: #FF9F0A` (thinking)
  - `--surface: #FFFFFF` (card background)
  - Font stack: `-apple-system, BlinkMacSystemFont, "SF Pro", system-ui, sans-serif`
  - Body: `height: 100dvh; overflow: hidden; background: var(--fog);`
  - Hide all scrollbars globally

### Dependencies
- [ ] `npm install framer-motion` (only new dependency)
- [ ] React 19, Tailwind v4, Vite 7, ReactMarkdown, remarkGfm already in package.json

### Success criteria
Open browser at `localhost:7777`. See the fog gradient filling the viewport. "Good evening, Max" in the top-left corner (32px, weight 400, `rgba(0,0,0,0.85)`). Nothing else. Builds clean, no errors.

---

## Stage 2: Chat Card

**Goal:** Fully functional chat on fog. Streaming, voice, file attach, tool display. The heart of the app.

This is the largest stage. The chat card is the universal component that appears everywhere (Home surface, Project view, Focus mode). Get this right and everything else is layout.

### Port from client-v1/ChatView.tsx

The existing ChatView (~800 lines) has battle-tested logic for all of the following. Port the logic, restructure into the new component tree. Don't rewrite from scratch.

**What to port:**
- `groupMessages()` → `lib/groupMessages.ts` — coalesces consecutive same-kind items, inserts context_clear and plan_mode separators, computes vertical margins
- `classifyTool()` → `lib/classifyTool.ts` — splits tool calls into "trace" (Read, Glob, Grep, WebSearch, etc.) and "promoted" (Edit, Write, Bash, Agent, MCP create/send/delete)
- `TracePill` rendering — grouped trace with smart summary ("read server.ts · search 'pattern' +3")
- `PromotedPill` rendering — expandable tool call with input/result views
- `CodeBlock` — fenced code with language label and copy button
- `MessageBubble` — user message: `bg-gray-100` rounded rectangle, image grid, file attachment chips
- Agent message rendering — `ReactMarkdown` with `remarkGfm`, custom `pre`/`code` renderers, 15px/1.7 line height
- Input bar — auto-resizing textarea (max 150px), Enter sends / Shift+Enter newlines, send button (blue arrow when content, red stop when thinking), voice recording (MediaRecorder → POST /api/transcribe), file attach (hidden input + drag-drop + clipboard paste), image preview thumbnails, file pill chips
- Text delta buffering — `textBufferRef` pattern: buffer deltas, flush every 30 chars or 150ms for phrase-cluster streaming effect
- Thinking canvas animation — CSS `@property` animated blobs (3 radial gradients drifting). Yellow/orange/pink tones at subtle opacity. Triggers on `status === "thinking"`.
- Context clear / plan mode separators — centered horizontal rules with labels
- Notification display — centered rule with blue text for `::notify` content
- Debug overlay — Cmd+Shift+D toggle showing last 4 log lines + status + item count

### New components

#### ChatCard.tsx
The container. White card (`#FFFFFF`, `border-radius: 16px`, no border, no shadow, `max-width: 720px`).

Structure:
```
┌─────────────────────────────────┐
│ ChatCardHeader                  │  ← warm gray bg (#F5F5F7), chat name + status dot
│─────────────────────────────────│
│                                 │
│ Message list (scrollable)       │  ← grouped messages, auto-scroll to bottom
│                                 │
│─────────────────────────────────│
│ InputBar                        │  ← textarea + voice + attach + send
└─────────────────────────────────┘
```

- Header: chat name + StatusDot. On Home surface variant: also shows project name.
- No model label in header (always Opus, not shown).
- Message list: overflow-y auto, scroll to bottom on new messages.
- Props: `sessionId`, `variant?: "project" | "home"` (home adds project name to header)

#### StatusDot.tsx
- 8px circle
- Blue (`#007AFF`) when notification/needs-you
- Amber (`#FF9F0A`) when thinking/busy
- Absent (not rendered) when idle/quiet

### Hooks

#### useWebSocket.ts
Port the WebSocket connection logic from ChatView:
- Connect to `ws://{host}/ws/chat/{sessionId}`
- Handle `history_snapshot` → set full message list
- Handle `stream_item` → append to message list
- Handle `agent_status` → update status state
- Handle `chat_title_update` → update chat name
- Handle `context_cleared`, `plan_mode_entered` → insert separators
- Send `user_input` messages (text + images + files)
- Reconnect on disconnect

#### useStreamItems.ts
- Takes raw stream items from WebSocket
- Runs through `groupMessages()` to produce render-ready groups
- Manages text delta buffering (the 30-char/150ms flush)
- Returns: `{ groups, status, chatTitle, sendMessage }`

#### useVoice.ts
Port from ChatView:
- `MediaRecorder` API → record audio blob
- POST to `/api/transcribe` → get text back
- Return: `{ isRecording, startRecording, stopRecording, transcript }`

### Integration test
- [ ] Create a temporary route that renders a single ChatCard full-screen on fog
- [ ] Connect to an existing session via the sessionId
- [ ] Verify: messages render, streaming works, can send messages, voice transcription works, file attach works, tool calls display correctly, thinking animation triggers

### Success criteria
A single chat card on fog, fully functional. You can have a conversation with Claude through it. Streaming text appears in phrase clusters. Tool calls show as trace pills and promoted pills. Voice input works. File attach works. Code blocks render with copy button. Thinking state shows animated blobs. Send clears input and streams response.

---

## Stage 3: Project View + Threads

**Goal:** Navigate threads, work in a chat. The left-right layout.

### Server additions

Thread metadata needs server-side persistence (so it works across devices over Tailscale).

New endpoints (extend `server.ts`):

```
GET  /api/projects/{key}/threads
  → Read threads from metadata, return Thread[] with session status

POST /api/projects/{key}/threads
  body: { name?: string }
  → Create thread, return { threadId, projectKey, name, sessionIds: [], createdAt }
  → If no name, name is null (will be auto-named after first message)

POST /api/threads/{threadId}/sessions
  body: { sessionId: string }
  → Add session to thread's sessionIds[]

POST /api/threads/{threadId}/rename
  body: { name: string }
  → Update thread name

DELETE /api/threads/{threadId}
  → Remove thread (sessions remain, just ungrouped)
```

Storage: extend `~/.claude/aimessage-metadata.json` with a `threads` record:
```json
{
  "threads": {
    "thread-uuid-1": {
      "threadId": "thread-uuid-1",
      "projectKey": "-Users-maxwraae-projects-aiMessage-V3",
      "name": "Fix auth system",
      "sessionIds": ["session-1", "session-2"],
      "createdAt": "2026-03-04T..."
    }
  }
}
```

**Migration:** Existing sessions that have no thread get auto-wrapped. On first load of a project's threads, any session not in a thread becomes a single-session thread (named from the session's existing title). This prevents orphans and means the new UI works immediately with existing data.

### Thread auto-naming

When a thread is created with no name (user hits + and starts typing):
1. After the first assistant response, fire a Haiku one-shot (same pattern as session auto-naming in the existing engine)
2. Prompt: "Name this objective in 2-4 words. What is the user trying to accomplish?"
3. Input: the user's first message
4. Update thread name via POST /api/threads/{id}/rename

### Components

#### ThreadList.tsx
- Vertical list of threads for current project
- Each row: `StatusDot` (if any) + thread name (15px, weight 500, `rgba(0,0,0,0.65)`)
- Selected thread: slightly more present (darker text or subtle warm background tint)
- Ordering: notification first → active → quiet → recency within each group
- Top item: `+ New thread` in lighter gray (`rgba(0,0,0,0.35)`)
- Status per thread: highest-priority status from any chat in that thread (blue > amber > none)

#### ProjectView.tsx
Layout: two zones, no borders, no dividers.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │ ThreadList   │  │ ChatCard                    │  │
│  │ (~30%)       │  │ (~70%)                      │  │
│  │              │  │                             │  │
│  │ + New thread │  │ [full chat experience]      │  │
│  │              │  │                             │  │
│  │ 🔵 Fix auth  │  │                             │  │
│  │ 🟠 Rate limit│  │                             │  │
│  │   Draft spec │  │                             │  │
│  │              │  │                             │  │
│  └──────────────┘  └─────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- On fog background
- Thread list on the left, scrollable if many threads
- Chat card on the right for the selected thread's most relevant chat
- Selecting a thread: find the highest-priority chat (notification > active > most recent) and render it

### Hooks

#### useThreads.ts
- `GET /api/projects/{key}/threads` — fetch threads with status
- `POST /api/projects/{key}/threads` — create new thread
- `POST /api/threads/{id}/sessions` — add session to thread
- Cache in state, refresh on navigation and after mutations

### Thread creation flow
1. User clicks `+ New thread` in ThreadList
2. POST `/api/projects/{key}/threads` (no name yet)
3. POST `/api/agents` with `{ projectPath, model: "opus" }` → creates Claude session
4. POST `/api/threads/{id}/sessions` with the new sessionId
5. ChatCard renders for the new session (empty, ready to type)
6. User types first message → sends via WebSocket
7. After first response: auto-name fires, thread name updates in the list

### Navigation

Update `App.tsx`:
- State: `currentView: "home" | "project"`, `selectedProjectKey: string | null`, `selectedThreadId: string | null`
- Home → tap project → `currentView: "project"`, `selectedProjectKey: key`
- Project → back → `currentView: "home"`
- Thread selection: `selectedThreadId` updates, ChatCard re-renders with the relevant session

### Success criteria
You can see threads on the left, tap one, chat on the right. Create a new thread, start a conversation, thread gets auto-named. Status dots appear on threads when chats are thinking or have notifications. Navigate back to home (even if Home is just the greeting for now).

---

## Stage 4: Home View

**Goal:** The full landing experience. Greeting, pulse, project shelf. The two-view navigation works.

### HomeView.tsx

Three vertical sections with generous spacing:

#### 1. Greeting + Pulse

```tsx
// Greeting: time-aware
const hour = new Date().getHours()
const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
// → "Good evening, Max"
```

Greeting: 32px, weight 400, `rgba(0,0,0,0.85)`. Not bold.

Pulse subtitle: 20px, weight 300, `rgba(0,0,0,0.40)`. Computed from aggregate status:
- Count sessions with `status === "busy"` → "N thinking"
- Count sessions with notification → "N ready for you"
- Combine: "2 thinking · 1 ready for you"
- Nothing happening: "Everything's quiet"
- No projects: "What would you like to do?"

Reference: `Home base.png` for the clean greeting-on-fog feeling.

#### 2. Surface cards (post-V1 placeholder)

For V1: this section is simply absent. No surfaced notification cards yet. The space between greeting and shelf is just fog.

Post-V1: surfaced chat cards appear here when `::notify` fires. Each card is a `ChatCard variant="home"` with project name in the header and Haiku-summarized content. Build the slot now (a div that conditionally renders) but leave it empty.

#### 3. Project shelf

Horizontal scrollable row of ProjectCards. Four visible at once.

Reference: `Home view with shelves.png` and `Another home view with shelves.png` for the shelf layout pattern.

```
← scroll                                                      scroll →
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ aiMessage V3 │  │ ATLAS        │  │ SHARE        │  │ Harvard      │
│ 🔵 Fix auth  │  │ 🟠 Citation  │  │   Connect    │  │   Cover letter│
│ 🟠 Rate limit│  │ 🟠 Graph     │  │   Draft      │  │   Budget     │
│   Draft spec │  │   Frontend   │  │   Funding    │  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

Scroll container: `overflow-x: auto`, `scroll-snap-type: x mandatory`, `gap: 16px`. Hide scrollbar.

### ProjectCard.tsx

Two-column layout inside a white card (`#FFFFFF`, `border-radius: 16px`, `padding: 20px`). No border, no shadow.

**Left column:**
- Project title: 18px, weight 600. Blue (`#007AFF`) if any thread needs you, else `rgba(0,0,0,0.80)`.
- Thread list: same as ThreadList but compressed. 13px, weight 400, `rgba(0,0,0,0.55)`. StatusDots at 8px. Max ~5 threads visible, rest hidden.

**Right column:**
- Top: Project description. 14px, weight 400, `rgba(0,0,0,0.40)`. Two lines max, ellipsis overflow.
- Bottom: TBD (leave empty for V1).

**Data:** Projects from `GET /api/projects`. Thread list from `GET /api/projects/{key}/threads`. Description from metadata (manual, stored in `aimessage-metadata.json`).

**Tap action:** Navigate to ProjectView for this project. The card IS the project interior, compressed. Tapping steps through the portal.

### Hooks

#### useProjects.ts
- `GET /api/projects` — fetch all projects
- For each project, fetch threads and aggregate status
- Return: `{ projects, loading, refresh }`
- Poll every 10s (match existing pattern) or refresh on navigation

### Navigation (Framer Motion)

Wrap views in `AnimatePresence`:
```tsx
<AnimatePresence mode="wait">
  {currentView === "home" ? (
    <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}>
      <HomeView />
    </motion.div>
  ) : (
    <motion.div key="project" ...>
      <ProjectView />
    </motion.div>
  )}
</AnimatePresence>
```

For V1: simple fade transition (opacity 0 → 1, 300ms ease-out). Post-V1: the card-to-sidebar expansion animation described in DESIGN_V2.

### Success criteria
Land on Home. See greeting and pulse. See project shelf with real projects from `~/.claude/projects/`. Cards show thread names with status dots. Tap a card → fade to Project View. Back → fade to Home. Pulse subtitle updates when agent status changes.

---

## Stage 5: Floating Bar

**Goal:** Glass pill at bottom. Create new work. Search by name.

### FloatingBar.tsx

Fixed position, bottom center, always visible on both views.

```css
.floating-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  backdrop-filter: blur(20px);
  background: rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  padding: 8px 16px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.07);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 320px;
  max-width: 480px;
}
```

**Search input:** Left side. Placeholder "Search...". On type: filters visible content by name.
- On Home: filters project cards in the shelf
- On Project view: filters threads in the thread list
- Simple `includes()` match on name, case-insensitive
- Clear on navigate

**Action button (+):** Right side. Circular, subtle.
- On Home: opens a small menu → "New project" or select existing project to create thread in
- On Project view: creates new thread directly (same flow as `+ New thread` in ThreadList)

### Integration
- FloatingBar lives in App.tsx, outside the view AnimatePresence
- Passes `searchQuery` and `onSearch` to the active view
- Passes `onAction` that dispatches based on current view context

### Success criteria
Glass pill visible at bottom on both views. Type in search → project cards or threads filter in real time. Click + on project view → new thread created. Click + on home → presented with project choice.

---

## Stage 6: Transitions + Polish

**Goal:** The fog clears. Cards rise. Everything feels alive.

### View transitions
- Home → Project: fade out home, fade in project (V1 baseline)
- Post-V1 upgrade: project card expands, left column becomes sidebar, right column fades, chat slides in from right

### Card animations (Framer Motion)
- Project cards on shelf: `initial={{ opacity: 0, y: 20 }}` → `animate={{ opacity: 1, y: 0 }}` with stagger (50ms between cards)
- Thread list items: similar stagger on mount
- Chat card: `initial={{ opacity: 0, scale: 0.98 }}` → `animate={{ opacity: 1, scale: 1 }}`

### Status dot transitions
- Dot appearing: scale from 0 → 1, opacity 0 → 1, 200ms
- Dot color change (amber → blue): cross-fade, 200ms
- Dot disappearing: scale 1 → 0, opacity 1 → 0, 200ms

### Surface card rise/sink (post-V1 prep)
When a card surfaces to Home (notification):
- `initial={{ opacity: 0, y: 40 }}` → `animate={{ opacity: 1, y: 0 }}`, 400ms spring
When user responds and card sinks:
- `exit={{ opacity: 0, y: -20 }}`, 300ms ease-out

### Input bar polish
- Send button: scale bounce on tap (1 → 0.9 → 1, 100ms)
- Voice recording: pulsing red dot indicator
- File attach: thumbnail slides in from bottom

### Thinking canvas refinement
- Port the CSS `@property` blob animation from client-v1
- Three radial gradients drifting at different speeds
- Subtle opacity (0.03-0.06 range)
- Transition from idle-canvas to thinking-canvas: 400ms ease-out

### Scroll behavior
- Chat message list: smooth scroll to bottom on new message
- Project shelf: scroll-snap to card edges
- Thread list: no snap, natural scroll

### Success criteria
Navigation between views feels smooth. Cards animate in with stagger. Status dots pulse into existence. The thinking canvas breathes. Everything is 300ms ease-out. Nothing snaps, nothing jumps. The fog clears to reveal what was always there.

---

## Dependency graph

```
Stage 1: Foundation
  └── Stage 2: Chat Card (depends on fog + tokens from Stage 1)
        └── Stage 3: Project View + Threads (depends on ChatCard)
              └── Stage 4: Home View (depends on ProjectView + thread data)
                    └── Stage 5: Floating Bar (depends on both views existing)
                          └── Stage 6: Transitions (polish on top of everything)
```

Each stage produces a working, testable artifact. Nothing is built in the dark.

---

## What to port from client-v1/

| Source (client-v1/ChatView.tsx) | Target | Notes |
|---|---|---|
| `groupMessages()` | `lib/groupMessages.ts` | Extract as pure function. Same logic. |
| `classifyTool()` | `lib/classifyTool.ts` | Same classification rules. |
| `TracePill` component | `components/chat/TracePill.tsx` | Same rendering, new file. |
| `PromotedPill` component | `components/chat/PromotedPill.tsx` | Same rendering, new file. |
| `CodeBlock` component | `components/chat/CodeBlock.tsx` | Same rendering, new file. |
| `MessageBubble` component | `components/chat/MessageBubble.tsx` | Same rendering, new file. |
| Agent message markdown | `components/chat/AgentMessage.tsx` | ReactMarkdown + remarkGfm + custom renderers. |
| Input bar (textarea + voice + attach) | `components/chat/InputBar.tsx` | Same logic, new file. |
| Text delta buffering | `hooks/useStreamItems.ts` | Same 30-char/150ms pattern. |
| WebSocket connection | `hooks/useWebSocket.ts` | Same protocol, extracted as hook. |
| Thinking canvas CSS | `index.css` | Port the `@property` + `@keyframes` blob animation. |
| Debug overlay | `components/ChatCard.tsx` | Cmd+Shift+D toggle, last 4 log lines. |
| Context clear / plan mode | `lib/groupMessages.ts` | Part of message grouping. |
| Notification display | `components/chat/AgentMessage.tsx` | Blue centered rule for `::notify`. |

---

## Server changes summary

All changes are additive. Nothing breaks existing endpoints.

| Endpoint | Method | Stage | Purpose |
|---|---|---|---|
| `/api/projects/{key}/threads` | GET | 3 | List threads with status |
| `/api/projects/{key}/threads` | POST | 3 | Create thread |
| `/api/threads/{id}/sessions` | POST | 3 | Add session to thread |
| `/api/threads/{id}/rename` | POST | 3 | Rename thread |
| `/api/threads/{id}` | DELETE | 3 | Remove thread grouping |

Storage: `threads` object in `~/.claude/aimessage-metadata.json`.

Migration: on first GET of a project's threads, wrap any unthreaded sessions as single-session threads automatically.

---

## Non-goals for V1

- Dark mode
- Focus mode (2-up side-by-side)
- Full carousel (horizontal scroll with thread list hide)
- PWA manifest + push notifications
- Deep content search
- Proactive engine integration (heartbeat, activity log, scheduler)
- Mobile-specific layout
- Surfaced notification cards on Home (the slot exists but is empty)

These are all designed for (see DESIGN_V2.md) but not built yet. The architecture supports them. They come after V1 works.
