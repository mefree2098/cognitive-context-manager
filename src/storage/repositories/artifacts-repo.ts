import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { ArtifactBrief } from "../../types/artifact.js";
import { json, nowIso, parseJson, Row, text } from "./row-utils.js";

function mapArtifact(row: Row): ArtifactBrief {
  return {
    id: String(row.id),
    projectId: text(row.project_id),
    path: String(row.path),
    artifactType: String(row.artifact_type),
    summary: text(row.summary),
    lastHash: text(row.last_hash),
    lastSeenAt: String(row.last_seen_at),
    status: String(row.status) as ArtifactBrief["status"],
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {})
  };
}

export function hashFile(path: string): string | undefined {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return undefined;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

export class ArtifactsRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(input: {
    projectId?: string;
    path: string;
    artifactType?: string;
    summary?: string;
    lastHash?: string;
    status?: ArtifactBrief["status"];
    metadata?: Record<string, unknown>;
  }): ArtifactBrief {
    const existing = this.getByPath(input.projectId, input.path);
    const id = existing?.id ?? `artifact_${nanoid(12)}`;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO artifacts(id, project_id, path, artifact_type, summary, last_hash, last_seen_at, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, path) DO UPDATE SET
           artifact_type = excluded.artifact_type,
           summary = excluded.summary,
           last_hash = excluded.last_hash,
           last_seen_at = excluded.last_seen_at,
           status = excluded.status,
           metadata_json = excluded.metadata_json`
      )
      .run(
        id,
        input.projectId,
        input.path,
        input.artifactType ?? existing?.artifactType ?? "file",
        input.summary ?? existing?.summary,
        input.lastHash ?? existing?.lastHash,
        now,
        input.status ?? existing?.status ?? "tracked",
        json(input.metadata ?? existing?.metadata ?? {})
      );
    return this.getByPath(input.projectId, input.path)!;
  }

  getByPath(projectId: string | undefined, path: string): ArtifactBrief | undefined {
    const row =
      projectId === undefined
        ? (this.db.prepare("SELECT * FROM artifacts WHERE project_id IS NULL AND path = ?").get(path) as Row | undefined)
        : (this.db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND path = ?").get(projectId, path) as Row | undefined);
    return row ? mapArtifact(row) : undefined;
  }

  list(projectId?: string, limit = 30): ArtifactBrief[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM artifacts WHERE project_id = ? ORDER BY last_seen_at DESC LIMIT ?")
          .all(projectId, limit) as Row[])
      : (this.db.prepare("SELECT * FROM artifacts ORDER BY last_seen_at DESC LIMIT ?").all(limit) as Row[]);
    return rows.map(mapArtifact);
  }
}
