# aiMessage V3

A web-based terminal that connects to tmux sessions on your Mac, accessible from any device over Tailscale. Built to monitor and interact with AI coding agents (Claude Code, Codex, OpenCode) from your phone.

V3 is a ground-up rebuild of the foundation. Same product concept as V2, new body: single process, web-only, no Expo, no monorepo.

---

## What It Is

- Open a browser on your phone → see a live terminal running on your Mac
- Terminal connects to a persistent tmux session — close the tab, the session keeps running
- Access is over Tailscale. No auth layer needed at the application level.

## Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + TypeScript |
| WebSocket | ws |
| Terminal sessions | tmux |
| PTY bridge | node-pty |
| Terminal rendering | xterm.js (CDN, no build step in Slice 1) |

---

## How to Run

**Requirements:** Node 22 LTS, tmux installed, Tailscale running.

```bash
# Install dependencies
npm install

# Start the server
npx tsx server.ts
```

Open `http://localhost:7777` to verify locally.
Open `http://<tailscale-ip>:7777` from your phone to use over Tailscale.

The server binds `0.0.0.0:7777`. If you can reach the port via Tailscale, you're in.

---

## Current Status

**Slice 1: Complete.**

Two files — `server.ts` and `index.html`. The transport layer is proven:

```
browser (xterm.js) → WebSocket → Node.js (node-pty) → tmux → zsh
```

Verified:
- Terminal renders and accepts input
- Colors, cursor positioning, full TUI apps (htop, vim) work
- Close tab, reopen: tmux reattaches, session still alive
- Terminal resizes when browser window resizes
- Works from iPhone over Tailscale

---

## Known Issues / Gotchas

**node-pty binary permissions.** On some npm installs, node-pty's `spawn-helper` binary ships without execute permissions. If you get a permission error on startup, fix with:

```bash
chmod +x node_modules/node-pty/build/Release/spawn-helper
```

Add a `postinstall` script to `package.json` to automate this if needed.

**Node 25 breaks node-pty.** Use Node 22 LTS. Pin it with `.nvmrc` or just document it. Node 25 has compatibility issues with node-pty's native bindings.

**tmux path.** Do not hardcode the tmux binary path. The server passes `env: { ...process.env }` to node-pty, which inherits PATH from the shell. This is the correct approach — hardcoded paths break on different machines and shell setups.

---

## What's Next

**Slice 2: React Shell**

Replace the single HTML page with a Vite + React + TypeScript + Tailwind app. The server serves the built client as static files. xterm.js moves into a React component. Basic layout: sidebar (agent list) + main area (terminal view).

Same terminal experience as Slice 1, but inside a real app with a layout skeleton.

**Slice 3: Agent Manager** — spawn and manage multiple tmux sessions from the UI.

**Slice 4: Structured Events** — port the V2 parser pipeline. See structured Claude Code output instead of raw terminal.

**Slice 5: Polish and Mobile** — PWA manifest, responsive layout, home screen install.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Web only, no Expo | Simpler, faster; Tailscale makes native app unnecessary |
| Single repo, not monorepo | One process, one build, no package interdependencies |
| tmux for session persistence | Native, battle-tested; agents survive server restarts |
| Tailscale for auth | Zero application-level auth needed |
| Node.js, not Bun | Ecosystem maturity, node-pty compatibility |
| No database | JSON files on disk, proven sufficient in V2 |
