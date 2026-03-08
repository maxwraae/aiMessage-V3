
# Surface

An AI-agent operating system. Two views. Fog and typography. Nothing else.

---

## Philosophy

Surface is both noun and verb. The surface is what you see — the top layer of a deep, living system. Things surface — they rise toward you when they need attention, and sink into fog when they don't.

Every design decision follows one rule: **clarity only where needed, fog everywhere else.**

No chrome. No panels. No dividers. No tab bars. No shadows. Just words at different opacities floating on atmosphere.

---

## Stack

**React 19 + Framer Motion + Tailwind v4 + Vite 7.** Desktop-first. Fresh client build — not a refactor of the existing client.

Framer Motion handles all transitions: the fog clearing, cards rising, depth shifts. Nothing animates by default; motion is reserved for meaningful state changes. PWA manifest and push notifications come after V1, not during.

---

## Hierarchy

```
Project     →  one objective (weeks–months)
  Thread    →  one objective within a project
    Chat    →  one objective within a thread
```

Three words a child could understand. Three levels. And they are all the same thing: **objectives.** A project is an objective that contains smaller objectives that contain even smaller objectives. The hierarchy isn't organizational — it's intentional. Every level answers the same question: *what are we trying to do?*

Threads aren't "groups of chats." They're objectives being pursued through multiple conversations. Chats aren't "conversations." They're objectives being pursued with one agent in one sitting. The whole tree is purpose, not structure.

You don't "create a thread." You declare an intent, and the system gives it a place in the tree.

### Data behind the hierarchy

**Projects** are discovered from `~/.claude/projects/` — Claude's own vault. Surface doesn't invent its own project concept; it reads what Claude Code already knows. A small metadata layer in `~/.claude/aimessage-metadata.json` extends each project with: display name (aliases), a 2-line description, and a lastOpened timestamp.

**Threads** are metadata-only. They don't exist at the engine level — the engine only knows about sessions. A thread is a lightweight grouping: `{ threadId, projectKey, name, sessionIds[], createdAt }`. Stored in `aimessage-metadata.json` or a `threads.json` per project. No engine changes needed.

**Chats** are Claude Code sessions. Every chat lives inside a thread. There are no orphan chats floating at the project level.

**Sessions** already carry full metadata in `~/.aimessage/sessions/{id}/metadata.json`. Surface reads this directly.

### Project card descriptions

The 2-line description on each project card is manually set via metadata for V1 — same place as aliases. In future it could be generated from the project's `CLAUDE.md`. For now: you write it, it sits there.

---

## Status

Two states. Only when relevant.

- 🔵 **Blue** — needs you. The agent has made a decision to surface. It's an action, not a status. The agent is raising its hand: "I need your attention." A blocker, a question, a decision point.
- 🟠 **Amber** — thinking. Agent is actively working.
- **No dot** — nothing to say. Clean. "I am finished" is not a state. Nobody cares that you finished. Only surface when you need something.

That's it. If there's nothing to communicate, there's no dot. The absence of a dot IS the status.

Status propagates upward. A blue chat makes its thread blue, which makes its project title blue on Home. You can always see at a glance: does anything need me? The signal bubbles up the objective tree without you navigating into it.

### How the blue dot is triggered

The blue dot is not a polling mechanism. The agent decides when to surface.

The convention: the agent writes `::notify [message]` in its output. The engine captures this as a `notification` stream item. That is the blue dot trigger. Nothing else is. The agent decides when it has something worth interrupting you for. If the agent doesn't write `::notify`, no blue dot appears — no matter how long it's been running.

This is an action, not a status. The agent is not "done" — it's asking. The distinction matters for how you design the response: acknowledge and continue, not close and archive.

### Amber

Maps directly to engine status `busy`. When the engine transitions from `sleeping` to `busy`, the amber dot appears. When it returns to `idle`, the dot disappears. No logic needed in the UI — read the engine state.

### No dot

Idle or sleeping. Same visual treatment. The absence of dot is not a state to design around — it's just silence.

---

## The Two Views

There are only two views in Surface. Home, and Project. Everything happens in one of these two places.

---

### View 1: Home

Home is where you land. It exists to answer one question: **what needs me right now?**

#### Top section: Greeting and pulse

**Top-left, large:** A greeting. Warm, not performative. Changes with time of day.

```
Good morning, Max
```

Weight 400, ~32px, dark gray. Not bold. Just present.

**Below it, lighter:** A dynamic line. This is the pulse — it changes based on what's actually happening across all your projects.

```
2 thinking · 1 ready for you
```

Or, when nothing is happening:

```
Everything's quiet
```

Weight 300, ~20px, secondary gray. You glance at it and know the state of your entire system. LLM-generated, updates as state changes. Everything it mentions is clickable: "1 ready for you" takes you directly to that chat.

**Dynamic subtitle examples:**

| State | Subtitle |
|---|---|
| Nothing happening | *Everything's quiet* |
| Agents working | *3 threads are thinking* |
| Needs input | *1 thread wants your input* |
| Mixed | *2 thinking · 1 ready for you* |
| Morning, fresh start | *Pick up where you left off?* |
| All done | *All caught up* |

#### Middle section: The Surface

Below the greeting, after generous space: **chat cards.** The same chat card component used everywhere in the app. They have floated up from their projects because the agent needs your attention — specifically, because the agent wrote `::notify`.

Each card is a live, interactive chat. Blue dot in the header (that's why it's here). The header shows: chat name + project name (so you know where it came from). The agent's last significant output is visible — summarized into 1-2 actionable lines by a Haiku one-shot call, using the same `lib/claude-one-shot.ts` pattern (Pro subscription, no API credits). The input bar sits at the bottom of the card.

```
┌──────────────────────────────────────────────┐
│  🔵 Fix auth system          aiMessage V3    │  ← header
│──────────────────────────────────────────────│
│                                              │
│  All 12 tests pass. Ready to commit          │
│  when you are.                               │
│                                              │
│──────────────────────────────────────────────│
│  Type a reply...                         [➤] │  ← input
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  🔵 PI availability          Harvard Prep    │
│──────────────────────────────────────────────│
│                                              │
│  Your PI rescheduled to Thursday 2pm.        │
│  Should I confirm or suggest a new time?     │
│                                              │
│──────────────────────────────────────────────│
│  Type a reply...                         [➤] │
└──────────────────────────────────────────────┘
```

Cards are stacked vertically. You scroll down through them. You can respond right there on Home, never navigating away. Type, send, the card immediately sinks back into the fog. The blue dot clears. The agent has what it needs and continues working.

One component rules everything. Chat card on the Surface, chat card in Project View, chat card in Focus Mode. Same thing at different zoom levels.

If nothing needs you: this section simply isn't there. Just fog and the project shelf below.

#### Bottom section: Project shelf

Your projects, displayed as cards in a horizontal scrollable shelf. Four cards visible at once. Scroll left/right to see more. Ordered by most recently opened.

##### Project card anatomy

Each card is a compressed view of the project interior — a portal, not a label.

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  aiMessage V3            Real-time collab        │
│  🔵 Fix auth             messaging app           │
│  🟠 Rate limiting                                │
│     Draft V3 spec        · · ·                  │
│     Design tokens                                │
│                                                  │
└──────────────────────────────────────────────────┘
```

The card has two columns.

**LEFT column, top-aligned: Project title + thread list.** The title sits at the top, bold. **Blue when anything inside needs you.** Dark gray when nothing does. The title IS the indicator — no separate dot needed. Directly below: the thread list, same as you'd see inside the project. Same dots, same names, same order (most recent at top). Dots where there are dots, nothing where there's nothing. Thread names truncate if long.

This is intentional: the left column of the card is exactly what the sidebar looks like once you're inside the project. Project name at the top, threads below. The card is not a label — it's the interior, compressed. What you see on the card IS what's on the other side of the portal.

**RIGHT column, top zone: Project description.** Two lines max, lighter gray. The identity of the project — what is this thing. Static. Not the objective, not a status line — just what the project is.

**RIGHT column, bottom zone: Flexible.** This space is TBD. Candidates: last opened date (faint, temporal grounding), quick action buttons ("New thread", "New chat"), small icon set for active capabilities, or nothing at all. The constraint is that it must not compete with the thread list. Whatever goes here stays faint and secondary.

##### Card states

**Active, needs you** — title goes blue, blue dots visible on threads:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  aiMessage V3            Real-time collab        │
│  🔵 Fix auth             messaging app           │
│  🟠 Rate limiting                                │
│     Draft V3 spec                                │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Active, working** — title stays dark gray, amber dots on threads:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  ATLAS                   Citation topology       │
│  🟠 Citation parser      for scientific lit      │
│  🟠 Graph layout                                 │
│  🟠 Wittgenstein corpus                          │
│     Frontend prototype                           │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Quiet** — no dots, almost ghostly:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  SHARE                   Danish-US research      │
│     Connect researchers  exchange program        │
│     Draft partnership                            │
│     Funding model                                │
│                                                  │
└──────────────────────────────────────────────────┘
```

##### Card transition

When you tap a card, the left column (project name + thread list) **becomes** the sidebar in Project view. It expands. The thread list grows to full size on the left, the first relevant chat opens on the right. You were already looking at the interior; now you've stepped inside.

The card isn't a label for the project. The card IS the project, compressed. Every card is a portal, and what you see on the left column is literally the sidebar on the other side.

---

### View 2: Project

You've tapped a project card. The fog shifts. You're inside.

#### Depth order

Three layers at all times in Project View:

1. **Foreground** — Active chat card(s) for the selected thread. Full presence.
2. **Mid-ground** — Thread list. Visible when you're choosing. Recedes when you're working.
3. **Background** — The fog. Always there. The interface breathes in it.

#### Layout

At rest, the screen has two zones. No borders, no dividers — just content on fog at different positions.

**Left side (~30%): Thread list**

Threads listed vertically. The same list you just saw on the card, now at full size. Each thread shows its name and its dot (if it has one):

```
🔵 Fix auth system
🟠 Rate limiting
   Draft V3 spec
   Design system tokens
```

- 🔵 Blue dot — needs you
- 🟠 Amber dot — thinking
- No dot — quiet

Threads are ordered by: notification first, then active, then quiet, then by recency within each group. Things needing you are always at the top.

Each thread name is tappable. The currently selected thread is slightly more present (darker text, or a subtle warm background tint — barely visible).

At the top of the thread list: **+ New thread** in lighter gray.

**Right side (~70%): Chat area**

When you tap a thread, its most relevant chat opens to the right, full size. This is the primary interaction — one chat, in focus, ready to work. Most of the time, this is all you need.

Within a thread, you can spawn additional chats for different angles on the same objective. Those chats extend further right as cards. You scroll horizontally to reach them. The carousel is available but secondary — the primary interaction is: select thread, see focused chat, work in it.

*(Full carousel behavior — hide-on-scroll thread list, horizontal expansion to full width — is post-V1.)*

```
┌──────────────────┐  ┌──────────────┐  ┌─────────────┐
│ Thread list      │  │ Fix auth     │  │ Rate        │
│                  │  │ (focused)    │  │ limiting    │
│ 🔵 Fix auth      │  │              │  │ (next)      │
│ 🟠 Rate limiting │  │ You: Check   │  │             │
│    Draft V3 spec │  │ tokens       │  │  · · ·      │
│                  │  │              │  │             │
│                  │  │ Agent: Fixed.│  │             │
│                  │  │ Want me to   │  │             │
│                  │  │ commit?      │  │             │
│                  │  │              │  └─────────────┘
│                  │  │ [Commit]     │
│                  │  │              │  ←  scroll right
│                  │  │ Type here...│
└──────────────────┘  └──────────────┘
```

Chats are ordered: notifications first, then active, then by recency. The highest-priority chat is always the one in focus when you select a thread. You can scroll to any other chat and start typing immediately — no extra tap needed to switch.

The focused chat card:

```
┌─────────────────────────────────────────┐
│  Fix auth · 🔵                          │  ← header, warm gray bg
│─────────────────────────────────────────│
│                                         │
│  You: Check if the endpoint validates   │
│  tokens correctly                       │
│                                         │
│  Agent: Fixed. All 12 tests pass now.   │
│  Want me to commit?                     │
│                                         │
│  [Commit]  [Show diff]                  │
│                                         │
│─────────────────────────────────────────│
│  Type a message...                  [➤] │  ← input bar
└─────────────────────────────────────────┘
```

Header shows: chat name · status dot. No model label. Minimal.

#### Navigating within a thread

Chats within a thread are ordered: notification first, then active, then quiet, then by recency. The right-most cards are the quietest.

**Horizontal scroll = choosing a chat.** Scroll right through the carousel. Each card is a live chat — scroll to it, type.

**Thread list hides when you scroll into chats.** Once you begin scrolling the chat carousel, the thread list on the left fades and slides away. The chats expand to full width. You're in the work now — the thread list would be noise.

The logic: the thread list matters when you're choosing which thread to enter. Once you're scrolling through chats, you've chosen. The threads recede. When you want to switch threads — back tap or swipe right — the thread list slides back in.

This is a natural depth transition. Dive into the chats. Surface back to threads.

```
Choosing a thread:           In the chat carousel:

┌──────────┐ ┌──────────┐   ┌──────────────────┐ ┌──────────┐
│ Threads  │ │ Focused  │   │ Focused chat     │ │ Next     │
│          │ │ chat     │   │ (full width)     │ │ chat     │
│ 🔵 Fix   │ │          │   │                  │ │          │
│ 🟠 Rate  │ │          │   │                  │ │          │
│    Draft │ │          │   │                  │ │          │
│          │ │          │   │                  │ │  · · ·   │
└──────────┘ └──────────┘   └──────────────────┘ └──────────┘
thread list visible            thread list hidden, chats expand
```

#### Focus mode

Focus mode changes the axis entirely.

Instead of horizontal scroll, chats align two side-by-side, stacked vertically. You scroll **down** to see more. The background dims and fogs. Everything outside the cards disappears — full immersion.

```
┌─────────────────────────────────────────────────────────────┐
│                      [fog / dim]                            │
│                                                             │
│    ┌──────────────────────┐  ┌──────────────────────┐      │
│    │  Fix auth · 🔵       │  │  Rate limiting · 🟠  │      │
│    │──────────────────────│  │──────────────────────│      │
│    │                      │  │                      │      │
│    │  Agent: Fixed. Want  │  │  Agent: Analyzing    │      │
│    │  me to commit?       │  │  patterns...         │      │
│    │                      │  │                      │      │
│    │  [Commit] [Diff]     │  │                      │      │
│    │                      │  │                      │      │
│    │  Type here...    [➤] │  │  Type here...    [➤] │      │
│    └──────────────────────┘  └──────────────────────┘      │
│                                                             │
│    ┌──────────────────────┐  ┌──────────────────────┐      │
│    │  Draft V3 spec       │  │  Design tokens       │      │
│    │  ...                 │  │  ...                 │      │
│    └──────────────────────┘  └──────────────────────┘      │
│                      ↓ scroll down                          │
└─────────────────────────────────────────────────────────────┘
```

Both cards are fully interactive. The fog between them is an interaction target — tap it to exit focus mode. Or use a back gesture. Either returns you to the single-focused-chat horizontal scroll view.

Focus mode = depth. The world narrows to just the work in front of you.

#### Returning home

Back gesture or button. The project fades into fog. Home reappears with updated state.

---

## Visual Language

### Fog

The background is a gradient so subtle you're not sure it's there. Warm gray to the faintest blush to the palest lilac. It shifts imperceptibly — not animated, but alive.

```css
--fog: linear-gradient(
  135deg,
  hsl(240, 10%, 94%) 0%,      /* barely-lilac gray */
  hsl(350, 12%, 93%) 50%,     /* whisper of pink */
  hsl(30, 14%, 93%) 100%      /* breath of peach */
);
```

The fog is not decoration. It is functional. It holds everything. Content exists at different depths within it.

### Typography

Everything is typography. Hierarchy is expressed through size, weight, and opacity — never through boxes, borders, or color.

| Element | Size | Weight | Color |
|---|---|---|---|
| Greeting | 32px | 400 | `rgba(0,0,0,0.85)` |
| Dynamic subtitle (pulse) | 20px | 300 | `rgba(0,0,0,0.40)` |
| Surface chat card (same as chat card) | — | — | — |
| Project card title | 18px | 600 | `rgba(0,0,0,0.80)` or `#007AFF` |
| Project card description | 14px | 400 | `rgba(0,0,0,0.40)` |
| Project card thread name | 13px | 400 | `rgba(0,0,0,0.55)` |
| Project card (right bottom, TBD) | 12px | 400 | `rgba(0,0,0,0.30)` |
| Thread name (project view) | 15px | 500 | `rgba(0,0,0,0.65)` |
| Chat header | 14px | 500 | `rgba(0,0,0,0.50)` |
| Body text | 15px | 400 | `rgba(0,0,0,0.80)` |

Font: SF Pro (system). Nothing else.

### Status colors

Two colors. Only when relevant.

- 🔵 `#007AFF` — Blue. Needs you.
- 🟠 `#FF9F0A` — Amber. Thinking.
- No dot. No color. Nothing.

On project cards, the blue propagates to the title text itself — the title turns blue when anything inside needs attention.

Dots are 8px in cards and thread lists. They are the only color in the entire interface.

### Cards

Two types of cards exist in Surface. Both are white on fog, no shadow, no border.

**Chat cards** are the universal component. The same card appears on the Home Surface, in Project View, and in Focus Mode. One component at different zoom levels. On Home, the header adds the project name so you know where it came from.

**Project cards** (Home shelf):

```css
.project-card {
  background: #FFFFFF;
  border-radius: 16px;
  border: none;
  box-shadow: none;
  padding: 20px;
}
```

**Chat cards** (Project view):

```css
.chat-card {
  background: #FFFFFF;
  border-radius: 16px;
  border: none;
  box-shadow: none;
  max-width: 720px;
}

.chat-card-header {
  background: #F5F5F7;
  border-radius: 16px 16px 0 0;
  padding: 12px 16px;
}
```

No other element in the interface uses a container.

### Transitions

Everything fades. Nothing slides, bounces, or snaps. When you tap a project card, the thread list on the right side of the card expands into the full sidebar — the fog clears to reveal the project interior. The card was always a window; now you've stepped through it.

Duration: 300ms. Easing: ease-out. The feeling is: the fog clears to reveal what was always there.

---

## Interaction Summary

### The fast path (agent-driven)

1. Open Surface → see chat cards that need you
2. Read the agent's summary, type a reply right there on Home
3. Send → card sinks back into fog → agent continues working
4. Done. Never left Home. 10 seconds.

### The deliberate path (user-driven)

1. Open Surface → scan project cards in shelf
2. See blue title on a card → tap it
3. Thread list expands into sidebar, relevant chat opens
4. Read, respond, or start new work
5. Back → home

### The floating bar

A glass pill hovering at the bottom center of the screen, always present on both views. Close to you, not away from you. All action happens here.

```
┌─────────────────────────────────────────────────┐
│  🔍  Search...                           [+]    │
└─────────────────────────────────────────────────┘
```

**Left: Search.** For V1: name-based filter only. Filters the visible threads and projects by name as you type. Deep content search — across message history — comes later. The bar is present visually; the capability starts minimal.

**Right: Action button (+).** Creates new work. From Home: new project or new thread (choose a project or let the system infer). From Project view: new thread in this project.

Glass material: `backdrop-filter: blur(20px)`, semi-transparent white, subtle shadow. Floats above all content. The bar is always within thumb reach. Everything interactive gravitates toward the bottom of the screen, close to the user, not away.

Voice input lives in the chat card input bar, not the floating bar. The mic is next to the send button inside the chat. This is intentional: voice is for talking to an agent, not for navigation.

### Starting new work

Tap the **+** in the floating bar. From Home, choose a project or let the system route it. From Project view, it creates a new thread directly.

What happens next: a chat card opens immediately. You're typing into a live chat. There is no "name this thread" step, no modal, no form. You talk. After your first message, the AI names the thread from your intent. The thread emerges from declared intent, not manual creation.

---

## Model

There is no model picker. User-facing conversations always use Opus. That's it.

If a model ever needs to change, it's a deliberate restart-level action — not a toggle, not a dropdown in the header. The UI never surfaces this choice because it's almost never the right thing to be deciding mid-conversation.

Background agents spawned by Claude (Sonnet, Haiku) are not a UI concept. The user never sees or interacts with them. They are implementation, not experience.

---

## Focus Mode

Deferred to after V1. The specification above describes how it will work when it ships, but it does not ship in the initial build.

The core V1 experience is: select a thread → see one focused chat → work in it. That is enough.

---

## V1 Scope

What ships first:

- **Home view** — greeting + dynamic pulse subtitle + project shelf (horizontal scrollable cards)
- **Project view** — thread list on left + single focused chat on right
- **Floating bar** — + button for new threads/chats. Search as name-based filter.
- **Chat card** — the universal component with header, message history, input bar with voice

What comes after V1:

- Surfaced notification cards on Home (requires status propagation + Haiku summaries working end-to-end)
- Focus mode (2-up side-by-side)
- Chat carousel (horizontal scroll within a thread to reach other chats)
- Thread list hide-on-scroll behavior
- PWA manifest + push notifications
- Deep content search
- Proactive engine integration (heartbeat, activity log, scheduler)

The post-V1 list is not a backlog of missing features. It's the natural next layer. V1 is complete as a thing; what comes after makes it richer.

---

## Proactive Engine Compatibility

The design is already shaped to receive a proactive engine when it's ready.

Nothing about V1 needs to change when the engine is wired in:

- Heartbeat wakes a session → engine status becomes `busy` → amber dot appears automatically
- Session completes with `::notify` → blue dot appears → card floats to Home Surface
- Activity log summaries feed into the Home pulse subtitle ("2 thinking · 1 ready for you")
- Scheduled task messages arrive as normal messages inside existing chat cards

No new UI primitives are needed. The status system, the card component, the pulse subtitle — they're already the right receptacles. The engine fills them in.

---

## What Surface is not

- Not a chat app with a sidebar (Slack, Discord, ChatGPT)
- Not a file manager with AI (Finder, Files)
- Not a dashboard with widgets (Windows, macOS widgets)
- Not a notification center (iOS, Android)

Surface is an **operating environment for autonomous agents.** The agents do the work. You do the deciding. The interface exists to make the deciding effortless.

---

## The Jony Test

Can you describe every screen in one sentence?

**Home:** Things that need you, and things you're working on.

**Project:** Your threads on the left, the conversation on the right.

That's it. Two views. Two sentences. If you need a third sentence to explain any part of it, the design has failed.
