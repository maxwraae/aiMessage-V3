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
  projectKey: string;
  projectPath: string;
  title: string | null;
  preview: string | null;
  created: Date;
  modified: Date;
};

const CLAUDE_PROJECTS = path.join(os.homedir(), ".claude", "projects");
const METADATA_FILE = path.join(os.homedir(), ".claude", "aimessage-metadata.json");

const TITLE_CACHE = new Map<string, { title: string; mtime: number }>();

type Metadata = {
  projectAliases: Record<string, string>; // projectKey OR path -> alias
  sessionAliases: Record<string, string>; // sessionId -> alias
};

function loadMetadata(): Metadata {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(METADATA_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Failed to load metadata:", err);
  }
  return { projectAliases: {}, sessionAliases: {} };
}

function saveMetadata(metadata: Metadata) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  } catch (err) {
    console.error("Failed to save metadata:", err);
  }
}

export function renameProject(keyOrPath: string, alias: string) {
  const metadata = loadMetadata();
  metadata.projectAliases[keyOrPath] = alias;
  saveMetadata(metadata);
}

export function renameSession(id: string, alias: string) {
  const metadata = loadMetadata();
  metadata.sessionAliases[id] = alias;
  saveMetadata(metadata);
}

export function createProjectFolder(name: string, customPath?: string): string {
  const baseDir = path.join(os.homedir(), "projects");
  const projectPath = customPath 
    ? path.resolve(customPath.replace(/^~/, os.homedir()))
    : path.join(baseDir, name.toLowerCase().replace(/\s+/g, "-"));

  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  // Auto-alias this path to the human name
  renameProject(projectPath, name);
  
  return projectPath;
}

function decodeProjectPath(key: string, dir: string): string {
  const jsonlFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));

  for (const file of jsonlFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n").slice(0, 100); // Scan first 100 lines for CWD
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as any;
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "cwd" in parsed &&
          typeof (parsed as Record<string, unknown>).cwd === "string"
        ) {
          return (parsed as Record<string, string>).cwd;
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // Fallback: strip leading hyphen and treat rest as path. Ensure leading slash.
  if (key.startsWith("-")) {
    return "/" + key.slice(1).replace(/-/g, "/");
  }
  return key;
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
    const metadata = loadMetadata();
    const name = metadata.projectAliases[key] || metadata.projectAliases[projectPath] || path.basename(projectPath) || key;

    // Use listSessions to get the accurate count after filtering
    const actualSessions = listSessions(key);

    projects.push({
      key,
      path: projectPath,
      name,
      lastActivity,
      sessionCount: actualSessions.length,
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

    const sessionId = file.replace(/\.jsonl$/, "");
    const cacheKey = `${projectKey}:${sessionId}`;
    const cached = TITLE_CACHE.get(cacheKey);

    if (cached && cached.mtime === stat.mtime.getTime()) {
      const metadata = loadMetadata();
      const displayTitle = metadata.sessionAliases[sessionId] || cached.title;
      const projectPath = decodeProjectPath(projectKey, dir);
      sessions.push({
        id: sessionId,
        projectKey,
        projectPath,
        title: displayTitle,
        preview: null,
        created: stat.birthtime,
        modified: stat.mtime,
      });
      continue;
    }

    let title: string | null = null;
    let isJunk = false;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      
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
      TITLE_CACHE.set(cacheKey, { title, mtime: stat.mtime.getTime() });
      const metadata = loadMetadata();
      const displayTitle = metadata.sessionAliases[sessionId] || title;
      const projectPath = decodeProjectPath(projectKey, dir);

      sessions.push({
        id: sessionId,
        projectKey,
        projectPath,
        title: displayTitle,
        preview: null,
        created: stat.birthtime,
        modified: stat.mtime,
      });
    }
  }

  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}
