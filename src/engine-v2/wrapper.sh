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

RESTART_COUNT=0
MAX_RAPID_RESTARTS=5
RESTART_WINDOW_SECS=60
LAST_START=0

while true; do
  # --- Circuit breaker ---
  NOW=$(date +%s)
  if [ $((NOW - LAST_START)) -gt "$RESTART_WINDOW_SECS" ]; then
    RESTART_COUNT=0
  fi
  RESTART_COUNT=$((RESTART_COUNT + 1))
  LAST_START=$NOW

  if [ "$RESTART_COUNT" -gt "$MAX_RAPID_RESTARTS" ]; then
    echo "[wrapper] Circuit breaker tripped: Claude crashed ${RESTART_COUNT} times in ${RESTART_WINDOW_SECS}s. Terminating session." >> "$ERR"
    echo "{\"type\":\"stream_item\",\"item\":{\"kind\":\"system\",\"text\":\"[wrapper] Circuit breaker tripped: Claude crashed 5 times in 60s. Session terminated.\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}" >> "$OUT"
    exit 1
  fi
  # --- End circuit breaker ---

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

  # Exponential backoff before retrying
  if [ "$RESTART_COUNT" -le 1 ]; then
    BACKOFF=1
  elif [ "$RESTART_COUNT" -le 3 ]; then
    BACKOFF=3
  else
    BACKOFF=10
  fi
  echo "[wrapper] Backing off ${BACKOFF}s before restart (restart #${RESTART_COUNT})..." >> "$ERR"
  sleep "$BACKOFF"
done
