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
  sessionAliases: Record<string, string>; // sessionId -> manual rename (wins forever)
  sessionTitles: Record<string, string>;  // sessionId -> auto-generated name
};

function loadMetadata(): Metadata {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(METADATA_FILE, "utf-8"));
      return { projectAliases: {}, sessionAliases: {}, sessionTitles: {}, ...data };
    }
  } catch (err) {
    console.error("Failed to load metadata:", err);
  }
  return { projectAliases: {}, sessionAliases: {}, sessionTitles: {} };
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

export function setSessionTitle(id: string, title: string) {
  const metadata = loadMetadata();
  metadata.sessionTitles[id] = title;
  saveMetadata(metadata);
}

export function isManuallyRenamed(id: string): boolean {
  const metadata = loadMetadata();
  return !!metadata.sessionAliases[id];
}

export function getSessionTitle(id: string): string | undefined {
  const metadata = loadMetadata();
  return metadata.sessionTitles[id];
}

export function createProjectFolder(dirPath: string, name?: string): string {
  const cleaned = dirPath.trim().replace(/^['"`]+|['"`]+$/g, '');
  const projectPath = path.resolve(cleaned.replace(/^~/, os.homedir()));
  const displayName = name || path.basename(projectPath);

  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  renameProject(projectPath, displayName);

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
  const engineSessionsDir = path.join(os.homedir(), ".aimessage", "sessions");
  const claudeDir = path.join(CLAUDE_PROJECTS, projectKey);
  const requestedProjectPath = decodeProjectPath(projectKey, claudeDir);
  const appMeta = loadMetadata();

  const sessions: Session[] = [];

  // 1. Scan Engine Sessions
  try {
    if (fs.existsSync(engineSessionsDir)) {
      const ids = fs.readdirSync(engineSessionsDir);
      for (const id of ids) {
        const metaPath = path.join(engineSessionsDir, id, "metadata.json");
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          if (path.resolve(meta.projectPath) === path.resolve(requestedProjectPath)) {
            sessions.push({
              id,
              projectKey,
              projectPath: meta.projectPath,
              title: appMeta.sessionAliases[id] || appMeta.sessionTitles[id] || meta.title || "New Chat",
              preview: "Active session",
              created: new Date(), // Shallow
              modified: new Date(meta.lastSeen || Date.now()),
            });
          }
        }
      }
    }
  } catch { /* ignore */ }

  // 2. Scan Claude Vault (Shallow)
  try {
    if (fs.existsSync(claudeDir)) {
      const files = fs.readdirSync(claudeDir).filter(f => f.endsWith(".jsonl"));
      for (const file of files) {
        const id = file.replace(".jsonl", "");
        if (sessions.some(s => s.id === id)) continue; // Already have it from Engine

        const stat = fs.statSync(path.join(claudeDir, file));
        sessions.push({
          id,
          projectKey,
          projectPath: requestedProjectPath,
          title: "Terminal Chat",
          preview: "From Claude Vault",
          created: stat.birthtime,
          modified: stat.mtime,
        });
      }
    }
  } catch { /* ignore */ }

  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}
