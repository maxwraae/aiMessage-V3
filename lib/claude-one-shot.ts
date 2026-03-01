import { spawn } from "node:child_process";
import * as os from "node:os";

export type OneShotOptions = {
  model?: "haiku" | "sonnet" | "opus";
  systemPrompt?: string;
  prompt: string;
  sterile?: boolean; // If true, run from /tmp to ignore project CLAUDE.md
  timeoutMs?: number; // Kill and reject if no response within this time (default 30s)
};

const MAX_CONCURRENT_ONESHOTS = 3;
let activeOneShots = 0;
const oneShotQueue: Array<() => void> = [];

async function acquireOneShotSlot(): Promise<void> {
  if (activeOneShots < MAX_CONCURRENT_ONESHOTS) {
    activeOneShots++;
    return;
  }
  return new Promise<void>((resolve) => {
    oneShotQueue.push(() => {
      activeOneShots++;
      resolve();
    });
  });
}

function releaseOneShotSlot(): void {
  activeOneShots--;
  const next = oneShotQueue.shift();
  if (next) next();
}

/**
 * Executes a one-shot Claude command using the CLI's --print mode.
 * Hits the Pro/Max subscription, no API billing.
 * Clears nested-session env vars so it works when called from inside Claude Code.
 * Kills and rejects after timeoutMs (default 30s) if no response.
 */
async function _executeOneShot(options: OneShotOptions): Promise<string> {
  const { model = "haiku", systemPrompt, prompt, sterile = true, timeoutMs = 30000 } = options;

  const args = [
    "-p",
    "--model", model,
    "--no-session-persistence",
    "--dangerously-skip-permissions"
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: sterile ? os.tmpdir() : process.cwd(),
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",        // Force subscription mode
        CLAUDECODE: "",               // Bypass nested-session block
        CLAUDE_CODE_ENTRYPOINT: ""    // Bypass nested-session block
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let settled = false;
    let output = "";
    let error = "";

    const kill = (reason: string) => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGTERM"); } catch { /* already dead */ }
      reject(new Error(reason));
    };

    const timeout = setTimeout(() => kill(`Claude one-shot timed out after ${timeoutMs}ms`), timeoutMs);

    proc.stdout.on("data", (data) => { output += data.toString(); });
    proc.stderr.on("data", (data) => { error += data.toString(); });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Claude one-shot failed (code ${code}): ${error.trim()}`));
      }
    });

    proc.on("error", (err) => kill(`Claude one-shot spawn error: ${err.message}`));

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export async function executeOneShot(options: OneShotOptions): Promise<string> {
  await acquireOneShotSlot();
  try {
    return await _executeOneShot(options);
  } finally {
    releaseOneShotSlot();
  }
}
