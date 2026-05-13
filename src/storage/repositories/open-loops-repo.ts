import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { OpenLoopBrief } from "../../types/artifact.js";
import type { SourceRef } from "../../types/memory.js";
import { redactSecrets } from "../../core/secret-redactor.js";
import { json, nowIso, parseJson, Row, text } from "./row-utils.js";

function mapOpenLoop(row: Row): OpenLoopBrief {
  return {
    id: String(row.id),
    projectId: text(row.project_id),
    sessionId: text(row.session_id),
    title: String(row.title),
    description: String(row.description),
    status: String(row.status) as OpenLoopBrief["status"],
    priority: Number(row.priority),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: text(row.closed_at)
  };
}

export class OpenLoopsRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    projectId?: string;
    sessionId?: string;
    title: string;
    description: string;
    priority?: number;
    status?: OpenLoopBrief["status"];
    sourceRefs?: SourceRef[];
  }): OpenLoopBrief {
    const id = `loop_${nanoid(12)}`;
    const now = nowIso();
    const title = redactSecrets(input.title).text.slice(0, 180);
    const description = redactSecrets(input.description).text;
    this.db
      .prepare(
        `INSERT INTO open_loops(id, project_id, session_id, title, description, status, priority, source_refs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.sessionId,
        title,
        description,
        input.status ?? "open",
        input.priority ?? 3,
        json(input.sourceRefs ?? []),
        now,
        now
      );
    this.db.prepare("INSERT INTO open_loops_fts(id, title, description) VALUES (?, ?, ?)").run(id, title, description);
    return this.get(id)!;
  }

  get(id: string): OpenLoopBrief | undefined {
    const row = this.db.prepare("SELECT * FROM open_loops WHERE id = ?").get(id) as Row | undefined;
    return row ? mapOpenLoop(row) : undefined;
  }

  list(projectId?: string, includeClosed = false, limit = 20): OpenLoopBrief[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (projectId) {
      clauses.push("project_id = @projectId");
      params.projectId = projectId;
    }
    if (!includeClosed) clauses.push("status IN ('open', 'blocked')");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM open_loops ${where} ORDER BY priority ASC, updated_at DESC LIMIT @limit`)
      .all(params) as Row[];
    return rows.map(mapOpenLoop);
  }

  search(query: string, projectId?: string, limit = 10): OpenLoopBrief[] {
    const params: Record<string, unknown> = { limit, query: query.split(/\s+/).filter(Boolean).map((term) => `"${term}"`).join(" OR ") };
    const projectWhere = projectId ? "AND l.project_id = @projectId" : "";
    if (projectId) params.projectId = projectId;
    try {
      const rows = this.db
        .prepare(
          `SELECT l.* FROM open_loops_fts f
           JOIN open_loops l ON l.id = f.id
           WHERE open_loops_fts MATCH @query ${projectWhere}
           ORDER BY l.priority ASC, l.updated_at DESC LIMIT @limit`
        )
        .all(params) as Row[];
      return rows.map(mapOpenLoop);
    } catch {
      const rows = this.db
        .prepare(
          `SELECT * FROM open_loops WHERE description LIKE @like ${projectId ? "AND project_id = @projectId" : ""}
           ORDER BY priority ASC, updated_at DESC LIMIT @limit`
        )
        .all({ ...params, like: `%${query}%` }) as Row[];
      return rows.map(mapOpenLoop);
    }
  }

  close(id: string, resolution?: string): OpenLoopBrief | undefined {
    const loop = this.get(id);
    if (!loop) return undefined;
    const now = nowIso();
    this.db
      .prepare("UPDATE open_loops SET status = 'resolved', description = ?, updated_at = ?, closed_at = ? WHERE id = ?")
      .run(resolution ? `${loop.description}\nResolution: ${redactSecrets(resolution).text}` : loop.description, now, now, id);
    return this.get(id);
  }

  sourceRefs(id: string): SourceRef[] {
    const row = this.db.prepare("SELECT source_refs_json FROM open_loops WHERE id = ?").get(id) as Row | undefined;
    return row ? parseJson<SourceRef[]>(row.source_refs_json, []) : [];
  }
}
