# Flow: Multi-Chat Tiling (The Stage)

This document describes the logic for the "Multi-Chat" view, allowing up to 4 active conversations to be tiled on a single desktop screen.

---

## 1. The "Add to Stage" Interaction
**Goal:** Flexibly add or remove chats from the visible workspace.

1.  **Sidebar Hover (`App.tsx`):** When hovering an agent or history item, a "Split View" icon (square-plus) appears.
2.  **The Action:**
    *   **Standard Click:** Clears the `activeStageIds` array and sets the clicked ID as the sole resident (Single View).
    *   **Split Icon Click:** Checks if `activeStageIds.length < 4`. If so, it appends the ID to the array.
3.  **De-duplication:** If the ID is already on the stage, the UI "flashes" that specific tile to show it's already visible rather than adding it again.

---

## 2. The Smart Tiling Engine
**Goal:** Automatically adjust the layout based on the number of residents on the Stage.

1.  **Container (`App.tsx`):** A wrapper div with `display: grid` and a media query (`min-width: 1024px`).
2.  **Layout States:**
    *   **1 Slot:** `grid-cols-1`. Full height/width.
    *   **2 Slots:** `grid-cols-2`. 50/50 vertical split.
    *   **3 Slots:** `grid-cols-2` + `grid-rows-2`. Slot 1 spans the left column; Slots 2 & 3 stack in the right column.
    *   **4 Slots:** `grid-cols-2` + `grid-rows-2`. Traditional quadrant layout.
3.  **Mobile Fallback:** If `window.width < 1024`, the grid always forces `grid-cols-1` and only renders the *last* item in the `activeStageIds` array (acting as a standard single-view).

---

## 3. Multi-Instance Communication
**Goal:** Independent, simultaneous streaming for all tiles.

1.  **Isolation:** Each `<ChatView />` instance is passed a unique `agentId`.
2.  **WebSocket:** Each component instance manages its own `wsRef`. When 4 tiles are open, 4 separate WebSockets are active.
3.  **Server Scaling:** The Node server (`chat-agent.ts`) already supports multiple subscribers. Each `ChatView` instance joins the `subscribers` Set for its specific agent.
4.  **Unread Logic:** When a chat is on the Stage, it is considered "Seen." The `unreadCount` remains at 0 for all on-stage agents.

---

## 4. Slot Management (The Header)
**Goal:** Control individual tiles without leaving the Stage.

1.  **Tile Header:** Each tiled `ChatView` gets a compact header.
2.  **Actions:**
    *   **Focus:** Clicking anywhere in a tile sets it as the "Active" tile (visual highlight).
    *   **Collapse (⊖):** Removes the ID from `activeStageIds`. The process remains running in the sidebar but disappears from the screen.
    *   **Kill (✕):** Stops the background process and removes the tile.

---

## Logic Sequence Reference

| Step | Component | State Change |
| :--- | :--- | :--- |
| **1. Invite** | `SidebarItem` | `activeStageIds.push(id)` |
| **2. Layout** | `App.tsx` | `grid-template-columns` update |
| **3. Connect** | `ChatView` | `new WebSocket("/ws/chat/" + id)` |
| **4. Stream** | `chat-agent.ts` | `emit(entry, { type: "stream_item", ... })` |
| **5. Dismiss** | `TileHeader` | `activeStageIds.filter(i => i !== id)` |
