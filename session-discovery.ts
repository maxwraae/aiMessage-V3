import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { isNoise } from "./shared/filter-config.js";

export type Project = {
  key: string;
  path: string;
  name: string;
  lastActivity: Date;
  sessionCount: number;
};

export type Session = {
  id: string;
  title: string | null;
  preview: string | null;
  created: Date;
  modified: Date;
};

const CLAUDE_PROJECTS = path.join(os.homedir(), ".claude", "projects");

function decodeProjectPath(key: string, dir: string): string {
  const jsonlFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));

  for (const file of jsonlFiles) {
    try {
      const firstLine = fs.readFileSync(file, "utf-8").split("\n")[0];
      if (!firstLine) continue;
      const parsed = JSON.parse(firstLine) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "cwd" in parsed &&
        typeof (parsed as Record<string, unknown>).cwd === "string"
      ) {
        return (parsed as Record<string, string>).cwd;
      }
    } catch {
      // ignore parse errors
    }
  }

  // Fallback: strip leading hyphen and treat rest as path
  return key.startsWith("-") ? key.slice(1).replace(/-/g, "/") : key;
}

export function listProjects(): Project[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(CLAUDE_PROJECTS, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const key = entry.name;
    const dir = path.join(CLAUDE_PROJECTS, key);

    let jsonlFiles: string[];
    try {
      jsonlFiles = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => path.join(dir, f));
    } catch {
      continue;
    }

    if (jsonlFiles.length === 0) continue;

    let lastActivity = new Date(0);
    for (const file of jsonlFiles) {
      try {
        const mtime = fs.statSync(file).mtime;
        if (mtime > lastActivity) lastActivity = mtime;
      } catch {
        // ignore
      }
    }

    const projectPath = decodeProjectPath(key, dir);
    const name = path.basename(projectPath) || key;

    projects.push({
      key,
      path: projectPath,
      name,
      lastActivity,
      sessionCount: jsonlFiles.length,
    });
  }

  projects.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  return projects.slice(0, 50);
}

export function listSessions(projectKey: string): Session[] {
  const dir = path.join(CLAUDE_PROJECTS, projectKey);

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const sessions: Session[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }

    let title: string | null = null;
    let isJunk = false;

    try {
      const lines = fs.readFileSync(filePath, "utf-8").split("\n");
      
      // RULE 1: Skip sidechains
      const firstLine = lines[0];
      if (firstLine) {
        try {
          const parsed = JSON.parse(firstLine) as Record<string, unknown>;
          if (parsed.isSidechain === true) continue;
        } catch { /* ignore */ }
      }

      // Scan for title
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as Record<string, any>;
          if (obj.type === "user" && obj.message) {
            const content = obj.message.content;
            let text = "";
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              text = content.map((b: any) => b.text ?? "").join("").trim();
            }

            // Centralized Noise Filter
            if (isNoise(text)) {
              continue;
            }

            if (text) {
              title = text.slice(0, 60) + (text.length > 60 ? "…" : "");
              break;
            }
          }
        } catch { /* ignore */ }
      }

      if (!title) {
        isJunk = true;
      }

    } catch {
      isJunk = true;
    }

    if (!isJunk && title) {
      sessions.push({
        id: file.replace(/\.jsonl$/, ""),
        title,
        preview: null,
        created: stat.birthtime,
        modified: stat.mtime,
      });
    }
  }

  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}
