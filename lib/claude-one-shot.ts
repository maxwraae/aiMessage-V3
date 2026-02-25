import { spawn } from "node:child_process";
import * as os from "node:os";

export type OneShotOptions = {
  model?: "haiku" | "sonnet" | "opus";
  systemPrompt?: string;
  prompt: string;
  sterile?: boolean; // If true, run from /tmp to ignore project CLAUDE.md
};

/**
 * Executes a one-shot Claude command using the CLI's --print mode.
 * This hits the Pro/Max subscription and bypasses direct API billing.
 */
export async function executeOneShot(options: OneShotOptions): Promise<string> {
  const { model = "haiku", systemPrompt, prompt, sterile = true } = options;

  const args = [
    "-p",
    "--model", model,
    "--no-session-persistence",
    "--dangerously-skip-permissions"
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  // Final prompt can be passed as an argument or via stdin. 
  // Stdin is safer for very long text or complex characters.
  
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: sterile ? os.tmpdir() : process.cwd(),
      env: { ...process.env, ANTHROPIC_API_KEY: "" }, // Ensure we don't accidentally use API key
      stdio: ["pipe", "pipe", "pipe"]
    });

    let output = "";
    let error = "";

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      error += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Claude one-shot failed (code ${code}): ${error.trim()}`));
      }
    });

    // Write the user prompt to stdin and close it
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
