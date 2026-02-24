import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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

  const indexPath = path.join(dir, "sessions-index.json");
  if (fs.existsSync(indexPath)) {
    try {
      const raw = fs.readFileSync(indexPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as Session[];
      }
    } catch {
      // fall through to scan
    }
  }

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
    let preview: string | null = null;

    try {
      const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0];
      if (firstLine) {
        const parsed = JSON.parse(firstLine) as unknown;
        if (parsed !== null && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          if (obj.isSidechain === true) continue;
          if (typeof obj.title === "string") title = obj.title;
          else if (typeof obj.slug === "string") title = obj.slug;
          if (typeof obj.preview === "string") preview = obj.preview;
        }
      }
    } catch {
      // ignore
    }

    sessions.push({
      id: file.replace(/\.jsonl$/, ""),
      title,
      preview,
      created: stat.birthtime,
      modified: stat.mtime,
    });
  }

  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}
