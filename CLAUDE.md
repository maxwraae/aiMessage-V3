# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

aiMessage V3 is a web-based chat UI that wraps Claude Code's headless mode. Instead of terminal emulation, it spawns Claude with `--input-format stream-json --output-format stream-json` and proxies NDJSON events over WebSocket to a React frontend. The result is a multi-agent chat interface accessible from any device over Tailscale.

## Commands

```bash
npm run dev          # Concurrent: tsx watch server.ts + vite build --watch
npm run dev:server   # Server only (tsx watch)
npm run dev:client   # Vite dev server only
npm run build        # Vite builds client → dist/
npm start            # Production: tsx server.ts (serves dist/ + APIs)
npm run setup:voice  # Install MLX-Whisper for voice transcription
```

Access at `http://localhost:7777`. No app-level auth; Tailscale handles security.

## Architecture

### Data Flow

```
React UI ←→ WebSocket (/ws/chat/{sessionId}) ←→ TmuxSessionEngine ←→ tmux + wrapper.sh ←→ Claude CLI
```

The server also exposes REST endpoints for project/session management, agent lifecycle, and voice transcription.

### Three Layers

**Server** (`server.ts`): HTTP static server, REST API, WebSocket bridge. Connects to Claude sessions via TmuxSessionEngine, streams NDJSON events to connected clients. Auto-starts Tailscale tunnel on boot.

**Engine** (`src/engine-v2/`): Tmux + FIFO-based engine. `TmuxSessionEngine` manages Claude sessions via tmux processes and FIFO pipes; `wrapper.sh` runs inside each tmux session (`while true: cat FIFO | claude >> out.jsonl`); `JournalManager` persists session state to `~/.aimessage/sessions/{id}/` as append-only JSONL files (`in.jsonl`, `out.jsonl`, `metadata.json`). Sessions survive server restarts. Status machine: `sleeping` → `busy` → `idle`.

**Client** (`client/`): React 19 + Vite 7 + Tailwind v4. Main layout in `App.tsx` (sidebar + 1-4 tiled chat panes). Chat rendering in `components/ChatView.tsx`. Apple "Glass" design language: iMessage-blue user bubbles, raw typography for agent responses, vibrancy via backdrop-blur.

### Shared Code

- `shared/stream-types.ts` — Protocol types (`StreamItem`, `ChatWsServerMessage`, `ChatWsClientMessage`). All WebSocket communication follows these types.
- `shared/filter-config.ts` — Noise filtering. Hides mechanical Claude artifacts (memory extraction, attachment paths) from the UI. Add patterns here to suppress new noise types.

### Key Utilities

- `lib/claude-one-shot.ts` — Runs Claude CLI in `-p` mode for background tasks (chat naming, summarization) using Pro subscription instead of API credits. "Sterile mode" runs from `/tmp` to bypass project CLAUDE.md.
- `session-discovery.ts` — Maps `~/.claude/projects/` vault structure to UI. Manages project/session metadata and aliases stored in `~/.claude/aimessage-metadata.json`.

## Build & TypeScript

- ESM throughout (`"type": "module"` in package.json)
- Server tsconfig: `module: "NodeNext"`, `target: "ES2022"`, includes `*.ts` and `shared/**/*`, excludes `client/`
- Client tsconfig: separate config in `client/tsconfig.json`
- Vite root is `client/`, builds to `dist/`

## Design Mandates (from GEMINI.md)

These are non-negotiable architectural constraints:

1. **Tmux + FIFO architecture.** Sessions run inside tmux via `wrapper.sh`. The server writes to a FIFO; `wrapper.sh` pipes FIFO input into Claude CLI and appends stdout to `out.jsonl`. Sessions survive server restarts.
2. **One-Shot for background tasks.** Use `lib/claude-one-shot.ts` for naming, summaries, and logic gates. No API credits.
3. **History hydration before spawn.** Parse `.jsonl` from `~/.claude/projects/` and send to frontend before starting the Claude process. Resuming must feel instant.
4. **Filter all noise.** Machine metadata and sidechains go through `shared/filter-config.ts`. If it's not human-readable, hide it.
5. **Apple Glass design.** Blue iMessage bubbles for users (#007AFF), raw typography on canvas for agents (no bubbles). Backdrop-blur vibrancy. No generic web UI patterns.

## External Dependencies

- Claude CLI binary at `~/.local/bin/claude`
- Session data at `~/.claude/projects/` (Claude's own vault) and `~/.aimessage/sessions/` (engine journals)
- Voice transcription via Python bridge at `~/.claude/models/transcribe.py` (MLX-Whisper)
- Tailscale for remote access (auto-configured on server start)
