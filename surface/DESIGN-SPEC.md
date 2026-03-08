# Surface Chat Card Design Spec

A complete specification for how a chat card looks, reads, and behaves. Any designer or developer should be able to build this from what's written here.

---

## Philosophy

The card is a **document**, not a chat window. The agent's voice is the page itself. Text flows like a well-typeset article. Your messages are punctuation marks within that document.

Prose is only prose. No inline decorations, no code pills, no visual interruptions within a line of text. When the agent does something (reads a file, runs a command, writes code), that action becomes a **figure** in the document. Like a figure in a scientific paper: self-contained, compact, scannable.

No decoration earns its place unless it does real work.

---

## Layers

Three surfaces, stacked by color:

| Layer | Color | Purpose |
|-------|-------|---------|
| Page background | `#F0F0F0` (light neutral gray) | The desk. Everything sits on this. |
| Card | `#FFFFFF` (pure white) | The document. Defines itself by contrast against the page. No shadow, no border. |
| Glass pill | `rgba(255,255,255,0.62)` + backdrop blur | The control bar. Different material from the card. Floats at the top. |

The card earns its shape purely through color difference against the page. Like a white sheet on a gray desk.

---

## Card Container

- **Width**: 560px (yields ~500-520px reading column after padding)
- **Border radius**: 20px
- **Background**: `#FFFFFF`
- **Shadow**: none
- **Border**: none
- **Overflow**: hidden (clips content at rounded corners)

On the page, cards scroll horizontally with 32px gaps between them.

---

## Card Anatomy (top to bottom)

### 1. Header (Glass Pill)

A floating glass capsule containing session controls. The header area itself is transparent; only the pill has material.

**Header area:**
- Height: 52px
- Background: transparent
- Padding: 12px horizontal

**Glass pill:**
- Height: 36px
- Border radius: 999px (full pill)
- Background: `rgba(255,255,255,0.62)`
- Backdrop filter: `blur(12px) saturate(160%)`
- Border: `0.5px solid rgba(255,255,255,0.85)`
- Box shadow: `0 1px 4px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.04)`
- Padding: 12px left, 6px right
- Layout: horizontal, centered vertically, 8px gap

**Pill contents (left to right):**
1. Status dot (existing component)
2. Session title: 13px, weight 500, `rgba(0,0,0,0.70)`, flex 1, single line truncated
3. Checkmark button: 28px circle, `rgba(0,0,0,0.055)` background, 13px icon at `rgba(0,0,0,0.45)`

No other buttons in the header. The `+` button is removed.

---

### 2. Document Body (Message List)

The reading area. Scrollable. This is where the conversation lives.

**Container:**
- Padding: 28px horizontal, 24px top, 8px bottom
- Background: transparent (inherits card white)
- Vertical scroll, no horizontal scroll indicator

**Optimal reading dimensions (from Bringhurst):**
- 45-75 characters per line
- At 15px system font, the ~500px column width hits the sweet spot

---

### 3. Content Types

#### Agent Prose

The default. The page itself. No container, no bubble, no background.

- Font: `-apple-system, 'SF Pro Text', system-ui, sans-serif`
- Size: 15px
- Line height: 24px (1.6 ratio)
- Color: `rgba(0,0,0,0.85)`
- Weight: 400 (regular)
- Paragraphs: 16px margin bottom
- Bold: weight 600 (semibold, not heavy), color `rgba(0,0,0,0.90)`
- Headings: same font, heavier weight, slightly larger (h1: 18px/700, h2: 16px/700, h3: 15px/600)

**Inline code** is not a pill. It is just a font change to monospace at the same size. No background, no padding, no border. The monospace font is the only signal. It should be nearly invisible in the reading flow.

Agent text has no container. It sits directly on the white card surface. It reads like a book.

#### User Message

Your voice. Clearly distinct from the agent's prose.

- Alignment: right (flex-end)
- Background: `#2A2A2A` (near-black)
- Text color: `#FFFFFF`
- Font size: 15px
- Line height: 22px
- Weight: 400
- Padding: 12px horizontal, 10px vertical
- Border radius: 18px
- Max width: 75% of reading column
- Margin: 8px vertical (tucks into the prose flow, not a chapter break)

**Images and files attached by the user** do not live inside the pill. They become their own figure block above or below the text pill. The pill itself is text only, always compact.

The dark pill creates the conversation rhythm. Your message is the punctuation between blocks of agent prose.

#### Figures

Figures are the one reusable brick. One component, one shape, handles everything that isn't prose or a user message. Every figure follows the exact same pattern regardless of what's inside it.

---

## The Figure Component

### The Brick

Every figure is the same brick:

```
┌─────────────────────────────────────────────┐
│  [icon]  Caption text                    [>] │
│                                              │
│  Preview content (3-4 lines max)             │
│  ...                                         │
│                                              │
└──────────────────────────────────────────────┘
```

**Structure:**
1. **Header row**: icon (left) + caption (flex 1) + expand chevron (right)
2. **Preview area**: 3-4 lines of content. Never full content by default.
3. **Expanded state**: tap chevron to reveal full content. Collapses back.

**Properties:**
- Full width of the reading column
- Border radius: 12px
- Padding: 16px
- Margin: 12px vertical
- No border, no shadow

The figure is self-contained. You can read every figure in the document and understand what the agent did without reading any prose.

### Two Materials

The only variation between figures is color:

| Material | Background | Text | When to use |
|----------|------------|------|-------------|
| **Dark** | `#1C1C1E` | `#FFFFFF` | Code, diffs, terminal output, command results. Machine output. |
| **Light** | `#F5F5F5` | `rgba(0,0,0,0.75)` | Tool actions, search results, descriptions. Human-readable context. |

That's it. Two colors. Same brick.

### Grouping

Consecutive actions of the same type collapse into one figure. This handles volume gracefully.

- 8 file reads in a row = one figure: "Read 8 files" with the list inside
- 3 consecutive searches = one figure: "Searched 3 queries" with results inside
- A single code edit = one figure showing the diff preview

The grouping logic: if the agent does N consecutive actions of the same type with no prose between them, they merge into one figure. The caption reflects the group ("Read 8 files", "Ran 3 commands"). The preview shows the most important items. Expand to see all.

### Figure Types

All use the same brick. The only differences are material color, icon, and how the preview content renders.

**Code / Diff** (dark material)
- Icon: code bracket or diff icon
- Caption: filename, line range
- Preview: 3-4 lines of code, monospace 13px, syntax colored
- Expanded: full code block

**Command** (dark material)
- Icon: terminal prompt
- Caption: the command that was run
- Preview: last 2-3 lines of output
- Pass/fail: subtle green checkmark or red X next to icon
- Expanded: full output

**Tool action / Edit** (light material)
- Icon: tool-specific (pencil for edit, magnifying glass for search, etc.)
- Caption: what it did ("Edited auth.py, lines 42-48")
- Preview: brief description or small diff
- Expanded: full detail

**Search / Thinking** (light material)
- Icon: magnifying glass or thought bubble
- Caption: what was searched
- Preview: 2-3 key results as short lines
- Expanded: all results

**Image** (special case)
- No material background. The image IS the figure.
- Full width of reading column
- Border radius: 12px (clips the image corners)
- Caption below in muted text: `13px, rgba(0,0,0,0.45)`
- No expand affordance. The image is always visible.

**Document attachment** (special case)
- Light material
- Icon: document icon
- Caption: filename + file type
- Preview: first few lines of content or a thumbnail
- Expanded: full content or download link

**Child agent** (light material)
- Icon: agent/person icon
- Caption: agent name + task description
- Preview: current status or last output line
- Status dot: shows if still running
- Expanded: full agent output

---

### 4. Input Area

The bottom of the document. Where you write to the agent.

- Background: transparent (part of the white card)
- Padding: 12px horizontal, 8px top, 12px bottom

**Input field:**
- Background: `#F5F3F0` (warm light gray)
- Border radius: 12px
- Padding: 6px vertical, 14px left, 4px right
- Min height: 40px
- Font: 14px, system font
- Placeholder: "Message..." in `rgba(0,0,0,0.22)`
- No border, no outline on focus

**Send button (appears when text entered):**
- 32px circle
- Background: `rgba(0,0,0,0.10)`
- Arrow icon, white, 14px

**Voice button (when no text):**
- 32px circle
- Waveform icon, `rgba(0,0,0,0.25)`

---

## Typography Summary

| Element | Size | Weight | Line height | Color |
|---------|------|--------|-------------|-------|
| Agent prose | 15px | 400 | 24px | `rgba(0,0,0,0.85)` |
| Agent bold | 15px | 600 | 24px | `rgba(0,0,0,0.90)` |
| Agent h1 | 18px | 700 | 26px | `rgba(0,0,0,0.85)` |
| Agent h2 | 16px | 700 | 24px | `rgba(0,0,0,0.85)` |
| Agent h3 | 15px | 600 | 22px | `rgba(0,0,0,0.85)` |
| User message | 15px | 400 | 22px | `#FFFFFF` on `#2A2A2A` |
| Figure caption | 15px | 400 | 22px | varies by material |
| Figure code | 13px | 400 | 20px | `#FFFFFF` (dark) or `rgba(0,0,0,0.65)` (light) |
| Inline code | 15px | 400 | 24px | `rgba(0,0,0,0.85)` in monospace. No background. |
| Glass pill title | 13px | 500 | — | `rgba(0,0,0,0.70)` |
| Input text | 14px | 400 | 20px | `#000000` |

Font stack: `-apple-system, 'SF Pro Text', system-ui, sans-serif`
Monospace: `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`

---

## Document Flow Example

This is how a typical conversation reads in the card:

```
[Glass pill: "Fix auth bug" with status dot and checkmark]

────────────────── document body ──────────────────

I looked at the authentication flow and found the
issue. The bearer token is being stripped by the
middleware before it reaches the validation layer.

        ┌─────────────────────────────────────┐
        │ Now let's add a health check        │
        │ endpoint.                           │  ← user pill
        └─────────────────────────────────────┘

Added the health check endpoint. It returns
status, uptime, memory usage, and active
connection count, following the IETF health
check draft format.

┌─ dark ──────────────────────────────────────┐
│  </>  server.ts — added /health endpoint  > │
│                                             │
│  app.get('/health', (req, res) => {         │
│    res.json({                               │
│      status: 'ok',                          │
│  ...                                        │
└─────────────────────────────────────────────┘

┌─ light ─────────────────────────────────────┐
│  ✓  Ran npm test — 14 passing, 0 failing  > │
└─────────────────────────────────────────────┘

The endpoint is unauthenticated so load
balancers can probe it without credentials.

────────────────── input area ─────────────────────

[Message...                              🎙]
```

---

## Rules

1. **Prose is only prose.** No inline decorations. No code pills. No background boxes within a line of text. Inline code is just a font change to monospace.
2. **One brick for figures.** Same component, same shape, every time. Icon + caption + preview + expand. Two materials (dark/light). That's it.
3. **Figures never show full content by default.** 3-4 line preview max. Expand to see more.
4. **Consecutive actions group.** 8 reads become one "Read 8 files" figure, not 8 figures.
5. **User messages are text-only pills.** Images and attachments become their own figures, not embedded in the pill.
6. **The card has no shadow and no border.** It's white on a gray page. The contrast is enough.
7. **Figures are self-contained.** You can scan only the figures and understand what happened.

---

## What This Is Not

- Not a chat app. No chat bubbles on agent messages.
- Not a terminal. No ANSI codes, no raw output.
- Not a dashboard. No status bars, no sidebars within the card.
- Not decorated. No gradients, no colored borders, no badges.
- Not noisy. No inline pills, no code boxes mid-sentence, no visual speed bumps.

It's a document you're having a conversation with. The text is the interface.
