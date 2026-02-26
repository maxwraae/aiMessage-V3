# Flow: Unified Session Management & Notifications

This document codifies the "One Chat, One Instance" architecture. It replaces the distinction between "Active Agents" and "Past Sessions" with a single, persistent "Conversations" list.

---

## 1. The "Single Instance" Architecture
**Goal:** Every conversation exists only once in the sidebar. Clicking it manages the lifecycle of the underlying process automatically.

### The "Click" Logic Matrix
When a user selects a session in the sidebar:

| Current State | UI Location | Action Taken |
| :--- | :--- | :--- |
| **Visible** | Already on "The Stage" | **Focus:** Flash the tile border; Scroll to bottom. |
| **Warm** | Sidebar Only (Hidden) | **Attach:** Mount session to an empty slot on The Stage. |
| **Cold** | Sidebar Only (Hidden) | **Wake:** Spawn `claude` process + Hydrate History + Mount to Stage. |

---

## 2. Visual State Machine (The "Apple Glass" Glow)
The sidebar uses "Power States" to indicate process activity and attention requirements.

### Status Indicators
- **Cold (Historical):** The entry is desaturated (opacity: 0.6). It feels like a static archive.
- **Warm (Connected):** The entry is vibrant (opacity: 1.0). The background blur is more intense.
- **Thinking (Streaming):** A **Pulsing Amber Dot** appears at the 4 o'clock position of the avatar.
- **Nudge (Notification):** A **Glowing Blue Ring** surrounds the avatar. This is a "Persistent Call to Action."

### Unread vs. Nudge
- **Blue Dot (iMessage style):** Standard "You have unread messages."
- **Blue Ring (Nudge style):** High-priority notification triggered by an agent-specific intent (via Skill).

---

## 3. The `aiMessage` Skill Architecture
**Goal:** Allow agents to "reach out" of the chat and interact with the UI or the OS.

### Tool Definition: `send_notification`
The agent is provided with a "System Skill" that it can invoke when it wants to grab the user's attention.

```json
{
  "name": "send_notification",
  "description": "Nudges the user via a UI glow and system-level notification.",
  "parameters": {
    "type": "object",
    "properties": {
      "message": { "type": "string", "description": "The text for the notification bubble." },
      "priority": { "enum": ["low", "high"], "default": "low" },
      "action": { "type": "string", "description": "Optional: A brief label for the action button." }
    }
  }
}
```

### The "Nudge" Flow
1.  **Agent Intent:** Claude decides the task is finished and needs the user's eyes.
2.  **Tool Call:** Claude outputs `<tool_call name="send_notification" ... />`.
3.  **Server Execution (`server.ts`):** 
    *   Intercepts the call.
    *   Triggers `agent.status = 'nudge'`.
    *   (Optional) Executes a native `terminal` command to trigger a macOS notification.
4.  **Client Response:** 
    *   The Sidebar entry for that agent triggers the **Blue Ring Animation**.
    *   If the app is a PWA, the Service Worker displays a Push Notification on the user's phone.

---

## 4. Interaction Principles: "Digital Tool" Feel

1.  **Zero Latency History:** History is always read from the `.jsonl` file *before* the process is "warm." The user should never see a loading state for past messages.
2.  **Spring Physics:** Transitions between "Cold" and "Warm" states must use spring animations (e.g., `stiffness: 300`, `damping: 30`). The Blue Ring should "breathe" rather than flash.
3.  **Automatic Sleep:** To save resources, if a session hasn't been interacted with for X minutes, the server kills the `claude` process but keeps the `.jsonl` data. The UI reverts to "Cold" (Dimmed). Clicking it again performs a "Transparent Wake-up."

---

## Logic Sequence: Sidebar Interaction

1.  **User Clicks Session.**
2.  **`useSessionManager` Hook:**
    *   Is `agentPool[id]` active? 
        *   **YES:** Send `FOCUS_TILE` event.
        *   **NO:** Is it in the background?
            *   **YES:** `MOUNT_TO_STAGE`.
            *   **NO:** `SPAWN_PROCESS` -> `HYDRATE` -> `MOUNT_TO_STAGE`.
3.  **`ChatView` Component:**
    *   Connects to existing/new WebSocket.
    *   Subscribes to `stream_items`.
    *   If `agentStatus === 'nudge'`, clear the status on first user interaction (Keypress or Scroll).
