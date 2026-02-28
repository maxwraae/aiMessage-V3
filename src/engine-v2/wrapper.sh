#!/bin/bash
# wrapper.sh — tmux-hosted Claude process supervisor
# Usage: wrapper.sh <session-dir> <model> <project-dir>
# Runs inside tmux. tmux's only job: keep THIS alive.

SESSION_DIR="$1"
MODEL="${2:-sonnet}"
PROJECT_DIR="${3:-/tmp}"
FIFO="$SESSION_DIR/input.fifo"
OUT="$SESSION_DIR/out.jsonl"
ERR="$SESSION_DIR/err.log"

# Create FIFO if it doesn't exist
[ -p "$FIFO" ] || mkfifo "$FIFO"

# Ensure output file exists
touch "$OUT"

# Clean environment so Claude doesn't think it's inside another Claude
unset CLAUDE_CODE CLAUDECODE TERM_PROGRAM TERM_PROGRAM_VERSION

# Trap SIGINT in the wrapper so Ctrl-C (sent by engine interrupt)
# doesn't kill the loop. The cat|claude pipeline runs in a subshell
# with its own process group and receives SIGINT normally.
trap 'echo "[wrapper] SIGINT caught, continuing loop..." >> "$ERR"' INT

while true; do
  # Check for resume ID (written by server when it sees system.init)
  RESUME_FLAG=""
  if [ -f "$SESSION_DIR/resume_id" ]; then
    RESUME_ID=$(cat "$SESSION_DIR/resume_id")
    if [ -n "$RESUME_ID" ]; then
      RESUME_FLAG="--resume $RESUME_ID"
    fi
  fi

  # cd to project directory so Claude has the right context
  cd "$PROJECT_DIR"

  echo "[wrapper] Starting Claude (model=$MODEL, resume=$RESUME_ID, dir=$PROJECT_DIR)" >> "$ERR"

  # Blocks until server opens FIFO for writing
  # When server closes fd (crash/shutdown), cat gets EOF, Claude exits
  cat "$FIFO" | ~/.local/bin/claude -p \
    --input-format stream-json \
    --output-format stream-json \
    --dangerously-skip-permissions \
    --verbose \
    --include-partial-messages \
    --model "$MODEL" \
    $RESUME_FLAG \
    >> "$OUT" 2>>"$ERR"

  EXIT_CODE=$?
  echo "[wrapper] Claude exited (code=$EXIT_CODE), waiting for reconnection..." >> "$ERR"

  # Write a system marker to out.jsonl so observers know Claude exited
  echo "{\"type\":\"stream_item\",\"item\":{\"kind\":\"system\",\"text\":\"[wrapper] Claude process exited, awaiting reconnection...\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}" >> "$OUT"

  # Brief pause before retrying
  sleep 1
done
