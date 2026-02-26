# Persistent Process Architecture (Agent Tabs)

This document defines the core technical architecture of **aiMessage V3**. It shifts from a traditional "stateless web app" model to a **Persistent Process** model where the UI acts as a window into long-running agent instances.

---

## 🏗 The Core Concept: "Everything is a Process"

In aiMessage V3, a chat session is not just a row in a database. It is a **Live OS Process** running on the server.

- **The Agent:** A persistent instance of the Claude CLI.
- **The Tab:** A UI view that "points" to a specific background process.
- **The Stage:** A window manager that handles multiple simultaneous agent connections.

This architecture ensures that if you close your browser, the AI continues working. When you return, you aren't "reopening" a file; you are **reattaching** to a living process.

---

## 📂 1. Path-Locked Discovery (Fixing the "0 Items" Bug)

The foundation of this architecture is **Path Linkage**. We eliminate "guessing" by ensuring every session ID is permanently anchored to its Project Path.

### The Problem
Previously, when the UI refreshed, it "forgot" the project context. Clicking a session caused the server to look in the default home directory, leading to `Sending 0 items in snapshot`.

### The Solution: The "Daddy" Link
1. **Metadata Tagging:** The `listSessions` engine in `session-discovery.ts` now attaches the `projectPath` to every session object returned to the sidebar.
2. **Explicit Resuming:** When a user clicks a session, the frontend sends both `sessionId` AND `projectPath`.
3. **Absolute Hydration:** The server uses the provided `projectPath` to locate history files. Since the path is locked, the history is guaranteed to load correctly.

---

## 📂 2. The Global Process Registry

To maintain this "Tab" feel across refreshes, the server maintains a **source of truth** for all active work.

### The Memory Map
The server keeps a `Map<agentId, AgentEntry>` in memory. Each entry contains:
- `process`: The actual `ChildProcess` handle.
- `history`: The current message stack (streamed in real-time).
- `sidechains`: A list of active sub-agents spawned by this instance.
- `projectPath`: The absolute path where this agent is working.

### The Persistent Registry (`aimessage-registry.json`)
To survive server restarts or to help the client remember its "open tabs," we maintain a registry on disk:
```json
[
  { 
    "agentId": "active-uuid-1", 
    "sessionId": "claude-session-abc", 
    "projectPath": "/Users/max/projects/my-app",
    "status": "running"
  }
]
```

---

## 🔗 3. The "Attachment" Flow (Tab Logic)

When a user interacts with a session, the system follows a **"Window Attachment"** logic instead of a "Resume" logic.

### Flow: Opening a Chat
1. **Selection:** User clicks a session in the sidebar.
2. **Registry Check:** Frontend asks: *"Is there an active process for this session?"*
3. **Connect/Attach:**
   - **If Active:** The server provides the existing `agentId`. The frontend connects to the dedicated WebSocket `/ws/chat/:agentId`.
   - **If Idle:** The server spawns a new process, adds it to the Registry, and then provides the `agentId`.
4. **Hydration:** Upon connection, the server sends a `history_snapshot`. This isn't just the file on disk; it's the **entire live history** including partial messages and background tasks.

---

## 🌳 4. Nested Tabs (Sidechains / Sub-Agents)

Background agents (Sidechains) are treated as **Nested Sub-Tabs**. They are children of the Main Agent.

- **Visibility:** We stop filtering `isSidechain: true`. 
- **The Stack:** Every Main Agent entry tracks its children. 
- **UI representation:** 
    - **Header Dots:** Each active sub-agent is a pulsing dot in the header next to the model bubble.
    - **Live Activity Card:** Clicking the dots expands a small, translucent iOS-style card showing the specific task each background agent is performing (e.g., "Searching codebase", "Running tests").

---

## 🛠 Technical Protocol

### Connection Handshake
```typescript
// Client connects to existing agent
const ws = new WebSocket(`ws://server/ws/chat/${agentId}`);

// Server responds immediately with Snapshot
{
  "type": "history_snapshot",
  "items": [...],      // All messages
  "sidechains": [...], // Active sub-tasks
  "model": "sonnet"    // Current power state
}
```

### Process Lifecycle
| Action | Server State | Registry | UI State |
| :--- | :--- | :--- | :--- |
| **Open Tab** | `spawn()` | Added | Vibrant / Connected |
| **Close Tab (Browser)** | No Change | Persistent | Cold (cached) |
| **Kill Process (Manual)** | `kill()` | Removed | Static / History Only |
| **Sidechain Start** | `new SubProcess()` | Child Added | Pulse Indicator |

---

## Summary of Benefits

1. **Continuous Work:** Agents don't stop when you close the tab.
2. **Instant Resuming:** No "loading" state; you just reattach to the stream.
3. **No Mismatched Context:** History always finds its file because the path is part of the "Tab" metadata.
4. **Engine Transparency:** You see exactly how many sub-agents are working for you at any time.
