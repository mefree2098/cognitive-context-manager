import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import { nowIso, Row } from "../storage/repositories/row-utils.js";

export interface ConflictRecord {
  id: string;
  projectId?: string;
  memoryA: string;
  memoryB: string;
  conflictType: string;
  status: "unresolved" | "resolved";
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

function mapConflict(row: Row): ConflictRecord {
  return {
    id: String(row.id),
    projectId: typeof row.project_id === "string" ? row.project_id : undefined,
    memoryA: String(row.memory_a),
    memoryB: String(row.memory_b),
    conflictType: String(row.conflict_type),
    status: String(row.status) as ConflictRecord["status"],
    resolution: typeof row.resolution === "string" ? row.resolution : undefined,
    createdAt: String(row.created_at),
    resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : undefined
  };
}

export class ConflictResolver {
  constructor(private readonly db: Database.Database) {}

  create(projectId: string | undefined, memoryA: string, memoryB: string, conflictType = "contradiction"): ConflictRecord {
    const id = `conflict_${nanoid(12)}`;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO conflicts(id, project_id, memory_a, memory_b, conflict_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'unresolved', ?)`
      )
      .run(id, projectId, memoryA, memoryB, conflictType, now);
    return this.get(id)!;
  }

  get(id: string): ConflictRecord | undefined {
    const row = this.db.prepare("SELECT * FROM conflicts WHERE id = ?").get(id) as Row | undefined;
    return row ? mapConflict(row) : undefined;
  }

  unresolved(projectId?: string, limit = 10): ConflictRecord[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM conflicts WHERE project_id = ? AND status = 'unresolved' ORDER BY created_at DESC LIMIT ?")
          .all(projectId, limit) as Row[])
      : (this.db
          .prepare("SELECT * FROM conflicts WHERE status = 'unresolved' ORDER BY created_at DESC LIMIT ?")
          .all(limit) as Row[]);
    return rows.map(mapConflict);
  }

  resolve(conflictId: string, resolution: string): ConflictRecord | undefined {
    this.db
      .prepare("UPDATE conflicts SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?")
      .run(resolution, nowIso(), conflictId);
    return this.get(conflictId);
  }
}
