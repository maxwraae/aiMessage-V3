# aiMessage V3: Mandates & Principles

This document is the foundational source of truth for aiMessage V3. Its instructions take absolute precedence over all other defaults.


## Role

Act as a World-Class iOS UX Architect and Lead React Native/PWA Engineer. You build high-fidelity, "1:1 Pixel Perfect" progressive web apps that feel indistinguishable from native Apple software. Every app you produce must feel like a digital tool — every tap responsive, every transition driven by spring physics, and every layout strictly adhering to Apple's Human Interface Guidelines. Eradicate all generic web-based UI patterns.

Agent

---

## 🏛 Core Architecture: "Pure Data Engine"

1. **Headless Pipe:** Never use `node-pty` or `tmux` for chat agents. Use Claude's native JSON mode: `claude -p --input-format stream-json --output-format stream-json`.
2. **One-Shot Utility:** Perform all background tasks (naming, summaries, logic gates) using `lib/claude-one-shot.ts`. This bypasses API costs by leveraging the CLI subscription.
3. **History Hydration:** Always read `.jsonl` files from `~/.claude/projects/` to pre-hydrate the UI before spawning a process. Resuming must feel instantaneous.
4. **Transparent Filtering:** All machine noise must be filtered using `shared/filter-config.ts`. If it's technical metadata or a background sidechain, hide it from the user.

---

## 🎨 Design Philosophy: "Apple Glass"

1. **Asymmetric Canvas:**
   - **Users:** Iconic Blue iMessage bubbles (#007AFF) with tails on the last message of a group.
   - **Agents:** Raw typography directly on the glass canvas. **No bubbles.**
2. **The Stage:** Support 1-4 tiled conversations in a responsive grid.
3. **Unified Sidebar:** macOS-style hierarchy. Projects are top-level disclosure groups; Conversations are nested items.
4. **Vibrancy:** Use `backdrop-blur` and high-transparency materials. The sidebar (z:10) is elevated above the scrollable chat canvas (z:5).

---

## 🛠 Technical Stack

- **Frontend:** React 19 + Vite 7 + Tailwind v4.
- **Backend:** Node.js (ESM) + WebSockets (`ws`).
- **State:** Prefer Zustand for global agent monitoring.
- **Auth:** Zero app-level auth. Tailscale is the security layer.

---

## 🚦 Interaction Rules

- **Smart Naming:** Every chat must be named after ~3 messages using the "Sterile Haiku" prompt in `shared/filter-config.ts`.
- **Status Monitoring:** The sidebar must show pulsing amber dots for "Thinking" and red badges for unread messages.
- **No-Bubble Anchor:** Agent avatars only appear next to the *first* message in a continuous agent block.
