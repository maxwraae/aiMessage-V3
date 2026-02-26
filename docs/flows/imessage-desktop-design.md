# Flow & Design: Agent Messaging Interface

This document provides an absolute technical specification for the **Agent Messaging Interface** with a native "Apple Glass" aesthetic. This is a Messages-style app for communicating with local AI agents, optimized for both macOS and iOS with a focus on glass morphism, vibrancy, and asymetrical message styling.

---

## Overview: The Three-Level Hierarchy

1. **Projects**: Top-level containers (like groups/folders)
2. **Conversations**: Individual agent sessions within a project
3. **Messages**: The actual interactions
   - **User**: Encapsulated in the iconic Blue iMessage bubbles.
   - **Agent**: Raw typography directly on the glass canvas (no bubbles).

---

## 1. Design Tokens (Web Translation)

| Token | CSS / Tailwind Value | Application |
| :--- | :--- | :--- |
| `color-blue-accent` | `#007AFF` | User bubbles, primary buttons |
| `color-text-primary` | `rgba(255,255,255,0.9)` (Dark) | Message body text |
| `color-text-secondary` | `rgba(255,255,255,0.5)` | Timestamps, metadata |
| `glass-sidebar` | `backdrop-blur-3xl bg-white/10 border-r border-white/5` | Sidebar vibrancy |
| `glass-bubble-user` | `bg-[#007AFF]/85 shadow-sm` | User message capsule |
| `glass-canvas` | `bg-black/20` | Main chat area background |

---

## 2. Navigation Flow

### 2.1 macOS Unified Sidebar
Instead of a drill-down menu, macOS uses a **Unified Hierarchy**:
- **Sidebar (300px):**
    - **Section: Projects** (Disclosure Groups)
    - **Items:** Project names with a count badge.
    - **Expanded State:** Shows the recent **Conversations** nested under each project.
- **Action:** Clicking a Conversation opens it in the Stage. Clicking a Project expands its history.

### 2.2 Split View (Stage)
- Supports up to 4 simultaneous conversations in a grid.
- Each tile is an independent instance of the `ChatView` logic.

---

## 3. Asymmetric Component Logic

### 3.1 User Message (The Bubble)
User messages follow strict iMessage grouping rules to maintain the "Chat" feel.
- **Grouping Gate:** Messages from the same user within **60 seconds** cluster.
- **Radii Logic:**
    - `TOP`: `rounded-t-2xl rounded-br-sm rounded-bl-2xl`
    - `MIDDLE`: `rounded-l-2xl rounded-r-sm`
    - `BOTTOM`: `rounded-b-2xl rounded-tr-sm rounded-tl-2xl` + **Tail**
    - `SINGLE`: `rounded-2xl` + **Tail**

### 3.2 Agent Message (The Content)
Agents do not use bubbles. They appear as clean typography directly on the Stage.
- **Visual Anchor:** The Agent's avatar (32px) appears only next to the *first* message in a sequence.
- **Spacing:**
    - Consecutive Agent messages: `4px` gap.
    - Message following a User: `24px` gap.
- **Thinking State:** A minimal "Typing" indicator (three pulsing dots) appears inline where the next text will stream.

---

## 4. The Implementation Logic

### 4.1 Grouping Algorithm (React)
The frontend uses a `useMemo` hook to transform the flat message array into `MessageGroups`.

```typescript
function groupMessages(messages: Message[]) {
  // Returns an array of groups
  // Each group is marked as isUser: boolean
  // User groups trigger the Bubble radii logic
  // Agent groups trigger the Spacing/Avatar logic
}
```

### 4.2 Material Layering (Z-Index)
1. **Background:** Dynamic gradient (z-0)
2. **Chat Canvas:** Transparent scroll area (z-5)
3. **Sidebar:** Glass panel (z-10) - *Content slides UNDER this when scrolling*
4. **Agent Content:** Typography on canvas (z-5)
5. **User Bubbles:** Elevated capsules (z-15)
6. **Input Area:** Thick material pill (z-20)

---

## 5. Interaction Specification

### 5.1 The "Mic-to-Arrow" Morph
- **Empty State:** Shows a Gray Microphone icon.
- **Text Entry:** Transitions to a Blue Circle with a White Up-Arrow.
- **Animation:** `scale(0.8) opacity(0) -> scale(1) opacity(1)` using a `spring` curve.

### 5.2 Tapbacks (Reactions)
- Long-pressing or clicking a User Bubble reveals a floating glass menu.
- Options: Heart, Thumbs Up, Haha, Exclamation.
- Overlay uses `.prominentMaterial` (high contrast blur).

### 5.3 Auto-Scroll
- If the user is at the bottom, stay pinned.
- If the user scrolls up, show a small "New Messages" pill at the bottom center.
