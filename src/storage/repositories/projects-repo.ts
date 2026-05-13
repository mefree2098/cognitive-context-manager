import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { ProjectSummary, SessionSummary } from "../../types/project.js";
import { json, nowIso, parseJson, Row, text } from "./row-utils.js";

function mapProject(row: Row): ProjectSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    rootPath: text(row.root_path),
    gitRemote: text(row.git_remote),
    gitBranch: text(row.git_branch),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastSeenAt: String(row.last_seen_at),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {})
  };
}

function mapSession(row: Row): SessionSummary {
  return {
    id: String(row.id),
    projectId: text(row.project_id),
    codexSessionId: text(row.codex_session_id),
    startedAt: String(row.started_at),
    lastSeenAt: String(row.last_seen_at),
    status: String(row.status) as SessionSummary["status"],
    summary: text(row.summary),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {})
  };
}

export class ProjectsRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(project: ProjectSummary): ProjectSummary {
    const existing = this.get(project.id);
    const createdAt = existing?.createdAt ?? project.createdAt ?? nowIso();
    const updatedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO projects(id, name, root_path, git_remote, git_branch, created_at, updated_at, last_seen_at, metadata_json)
         VALUES (@id, @name, @rootPath, @gitRemote, @gitBranch, @createdAt, @updatedAt, @lastSeenAt, @metadataJson)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           root_path = excluded.root_path,
           git_remote = excluded.git_remote,
           git_branch = excluded.git_branch,
           updated_at = excluded.updated_at,
           last_seen_at = excluded.last_seen_at,
           metadata_json = excluded.metadata_json`
      )
      .run({
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        gitRemote: project.gitRemote,
        gitBranch: project.gitBranch,
        createdAt,
        updatedAt,
        lastSeenAt: updatedAt,
        metadataJson: json(project.metadata)
      });
    return this.get(project.id)!;
  }

  get(id: string): ProjectSummary | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
    return row ? mapProject(row) : undefined;
  }

  getByRoot(rootPath: string): ProjectSummary | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE root_path = ?").get(rootPath) as Row | undefined;
    return row ? mapProject(row) : undefined;
  }

  createOrResumeSession(projectId?: string, codexSessionId?: string): SessionSummary {
    if (codexSessionId) {
      const existing = this.db
        .prepare("SELECT * FROM sessions WHERE codex_session_id = ? ORDER BY last_seen_at DESC LIMIT 1")
        .get(codexSessionId) as Row | undefined;
      if (existing) {
        const now = nowIso();
        this.db.prepare("UPDATE sessions SET last_seen_at = ?, status = 'active' WHERE id = ?").run(now, existing.id);
        return this.getSession(String(existing.id))!;
      }
    }

    const id = `session_${nanoid(12)}`;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO sessions(id, project_id, codex_session_id, started_at, last_seen_at, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'active', '{}')`
      )
      .run(id, projectId, codexSessionId, now, now);
    return this.getSession(id)!;
  }

  getSession(id: string): SessionSummary | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return row ? mapSession(row) : undefined;
  }

  latestSession(projectId?: string): SessionSummary | undefined {
    const row = projectId
      ? (this.db
          .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY last_seen_at DESC LIMIT 1")
          .get(projectId) as Row | undefined)
      : (this.db.prepare("SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT 1").get() as Row | undefined);
    return row ? mapSession(row) : undefined;
  }

  updateSessionSummary(sessionId: string, summary: string, status: SessionSummary["status"] = "compacted"): void {
    this.db
      .prepare("UPDATE sessions SET summary = ?, status = ?, last_seen_at = ? WHERE id = ?")
      .run(summary, status, nowIso(), sessionId);
  }

  listProjects(limit = 20): ProjectSummary[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY last_seen_at DESC LIMIT ?").all(limit) as Row[]).map(mapProject);
  }
}
