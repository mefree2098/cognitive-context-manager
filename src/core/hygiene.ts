import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { CcmConfig } from "../types/config.js";
import { MemoriesRepo } from "../storage/repositories/memories-repo.js";
import { json, nowIso, Row } from "../storage/repositories/row-utils.js";

export class HygieneService {
  constructor(
    private readonly db: Database.Database,
    private readonly config: CcmConfig
  ) {}

  report() {
    const counts = this.db.prepare("SELECT stale_status, COUNT(*) AS count FROM memories GROUP BY stale_status").all() as Row[];
    const suspectedSecrets = this.db
      .prepare("SELECT COUNT(*) AS count FROM memories WHERE tags_json LIKE '%redacted:%'")
      .get() as { count: number };
    const lowSalience = this.db
      .prepare("SELECT COUNT(*) AS count FROM memories WHERE salience < 0.25 AND stale_status = 'active'")
      .get() as { count: number };
    return {
      retentionEnabled: this.config.retention.enabled,
      countsByStatus: Object.fromEntries(counts.map((row) => [String(row.stale_status), Number(row.count)])),
      suspectedSecrets: Number(suspectedSecrets.count),
      lowSalienceActive: Number(lowSalience.count)
    };
  }

  plan() {
    const cutoff = new Date(Date.now() - this.config.retention.archiveLowSalienceAfterDays * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT id, summary, salience, updated_at FROM memories
         WHERE stale_status = 'active' AND salience < 0.25 AND updated_at < ?
         ORDER BY updated_at ASC LIMIT 500`
      )
      .all(cutoff) as Row[];
    return rows.map((row) => ({
      action: "archive",
      memoryId: String(row.id),
      reason: `low salience ${row.salience} older than ${this.config.retention.archiveLowSalienceAfterDays} days`
    }));
  }

  run(dryRun = true) {
    const plan = this.plan();
    if (!dryRun) {
      const repo = new MemoriesRepo(this.db);
      for (const item of plan) repo.markStale(item.memoryId, "archived", item.reason);
      this.audit("hygiene_run", undefined, { archived: plan.length });
    }
    return { dryRun, actions: plan };
  }

  setStatus(memoryId: string, status: "archived" | "active" | "quarantined" | "tombstoned", reason: string) {
    this.db.prepare("UPDATE memories SET stale_status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), memoryId);
    this.audit(`memory_${status}`, memoryId, { reason });
    return new MemoriesRepo(this.db).get(memoryId);
  }

  private audit(action: string, targetId: string | undefined, details: Record<string, unknown>) {
    this.db
      .prepare(
        `INSERT INTO audit_log(id, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, 'memory', ?, ?, ?)`
      )
      .run(`audit_${nanoid(12)}`, action, targetId, json(details), nowIso());
  }
}
