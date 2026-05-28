import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { CcmConfig } from "../types/config.js";
import { MemoriesRepo } from "../storage/repositories/memories-repo.js";
import { json, nowIso, Row } from "../storage/repositories/row-utils.js";
import { ProjectAttributionService } from "./project-attribution.js";
import { ProjectStateService } from "./project-state.js";

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
    const lowSalienceByProject = this.db
      .prepare(
        `SELECT m.project_id, COALESCE(p.name, 'unknown') AS project_name, p.root_path,
                COUNT(*) AS count, AVG(m.salience) AS avg_salience,
                MIN(m.updated_at) AS oldest_updated_at, MAX(m.updated_at) AS newest_updated_at
         FROM memories m
         LEFT JOIN projects p ON p.id = m.project_id
         WHERE m.salience < 0.25 AND m.stale_status = 'active'
         GROUP BY m.project_id
         ORDER BY count DESC
         LIMIT 10`
      )
      .all() as Row[];
    const lowSalienceActive = Number(lowSalience.count);
    const duplicateCandidates = this.duplicatePlan({ limit: 100 }).length;
    const attributionCandidates = new ProjectAttributionService(this.db).attributionPlan({ limit: 100 }).length;
    return {
      retentionEnabled: this.config.retention.enabled,
      countsByStatus: Object.fromEntries(counts.map((row) => [String(row.stale_status), Number(row.count)])),
      suspectedSecrets: Number(suspectedSecrets.count),
      lowSalienceActive,
      duplicateCandidates,
      attributionCandidates,
      lowSalienceByProject: lowSalienceByProject.map((row) => ({
        projectId: typeof row.project_id === "string" ? row.project_id : undefined,
        projectName: String(row.project_name),
        rootPath: typeof row.root_path === "string" ? row.root_path : undefined,
        count: Number(row.count),
        avgSalience: Math.round(Number(row.avg_salience ?? 0) * 1000) / 1000,
        oldestUpdatedAt: String(row.oldest_updated_at),
        newestUpdatedAt: String(row.newest_updated_at)
      })),
      recommendations: hygieneRecommendations(lowSalienceActive, this.config.retention.archiveLowSalienceAfterDays, duplicateCandidates, attributionCandidates)
    };
  }

  plan(options: { olderThanDays?: number; limit?: number; projectId?: string } = {}) {
    const olderThanDays = options.olderThanDays ?? this.config.retention.archiveLowSalienceAfterDays;
    const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const params: Record<string, unknown> = { cutoff, limit };
    const projectClause = options.projectId ? "AND project_id = @projectId" : "";
    if (options.projectId) params.projectId = options.projectId;
    const rows = this.db
      .prepare(
        `SELECT id, summary, salience, updated_at FROM memories
         WHERE stale_status = 'active' AND salience < 0.25 AND updated_at < @cutoff
         ${projectClause}
         ORDER BY updated_at ASC LIMIT @limit`
      )
      .all(params) as Row[];
    return rows.map((row) => ({
      action: "archive",
      memoryId: String(row.id),
      reason: `low salience ${row.salience} older than ${olderThanDays} days`
    }));
  }

  run(dryRun = true, options: { olderThanDays?: number; limit?: number; projectId?: string } = {}) {
    const plan = this.plan(options);
    if (!dryRun) {
      const update = this.db.prepare("UPDATE memories SET stale_status = 'archived', updated_at = ? WHERE id = ?");
      const archive = this.db.transaction((items: Array<{ memoryId: string }>) => {
        const timestamp = nowIso();
        for (const item of items) update.run(timestamp, item.memoryId);
      });
      archive(plan);
      this.audit("hygiene_run", undefined, { archived: plan.length });
    }
    return { dryRun, actions: plan };
  }

  duplicatePlan(options: { projectId?: string; limit?: number; keepRecentHandoffs?: number } = {}) {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
    const keepRecentHandoffs = Math.max(1, Math.min(options.keepRecentHandoffs ?? 5, 50));
    const rows = this.memoryRows(options.projectId, limit);
    const actions: Array<{ action: "archive_duplicate_memory" | "archive_old_handoff"; memoryId: string; reason: string }> = [];
    const seen = new Set<string>();
    const byFingerprint = new Map<string, typeof rows>();
    for (const row of rows) {
      if (String(row.tags_json ?? "").includes("project_state")) continue;
      const fingerprint = memoryFingerprint(String(row.summary ?? ""), String(row.content ?? ""));
      if (!fingerprint) continue;
      const group = byFingerprint.get(fingerprint) ?? [];
      group.push(row);
      byFingerprint.set(fingerprint, group);
    }
    for (const group of byFingerprint.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
      for (const row of sorted.slice(1)) {
        if (seen.has(String(row.id))) continue;
        seen.add(String(row.id));
        actions.push({ action: "archive_duplicate_memory", memoryId: String(row.id), reason: `duplicate of newer memory ${sorted[0]?.id}` });
      }
    }

    const handoffsByProject = new Map<string, typeof rows>();
    for (const row of rows.filter((item) => isHandoffRow(item))) {
      const key = String(row.project_id ?? "global");
      const group = handoffsByProject.get(key) ?? [];
      group.push(row);
      handoffsByProject.set(key, group);
    }
    for (const group of handoffsByProject.values()) {
      const sorted = [...group].sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
      for (const row of sorted.slice(keepRecentHandoffs)) {
        if (seen.has(String(row.id))) continue;
        seen.add(String(row.id));
        actions.push({ action: "archive_old_handoff", memoryId: String(row.id), reason: `older compact-session handoff beyond newest ${keepRecentHandoffs}` });
      }
    }
    return actions.slice(0, limit);
  }

  runDuplicateHygiene(dryRun = true, options: { projectId?: string; limit?: number; keepRecentHandoffs?: number } = {}) {
    const actions = this.duplicatePlan(options);
    if (!dryRun) {
      const archive = this.db.prepare("UPDATE memories SET stale_status = 'archived', updated_at = ? WHERE id = ?");
      const timestamp = nowIso();
      const apply = this.db.transaction((items: typeof actions) => {
        for (const action of items) archive.run(timestamp, action.memoryId);
      });
      apply(actions);
      this.audit("duplicate_hygiene_run", undefined, { archived: actions.length });
    }
    return { dryRun, actions };
  }

  attributionPlan(options: { minConfidence?: number; limit?: number; includeMemories?: boolean } = {}) {
    return new ProjectAttributionService(this.db).attributionPlan(options);
  }

  repairAttribution(dryRun = true, options: { minConfidence?: number; limit?: number; includeMemories?: boolean } = {}) {
    const result = new ProjectAttributionService(this.db).repairAttribution(dryRun, options);
    if (!dryRun) {
      const state = new ProjectStateService(this.db);
      for (const projectId of new Set(result.actions.map((action) => action.toProjectId).filter(Boolean))) {
        state.update(projectId);
      }
      this.audit("attribution_repair_run", undefined, { repaired: result.actions.length });
    }
    return result;
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

  private memoryRows(projectId?: string, limit = 500) {
    const params: Record<string, unknown> = { limit };
    const projectClause = projectId ? "AND project_id = @projectId" : "";
    if (projectId) params.projectId = projectId;
    return this.db
      .prepare(
        `SELECT id, project_id, summary, content, tags_json, updated_at
         FROM memories
         WHERE stale_status = 'active' ${projectClause}
         ORDER BY updated_at DESC
         LIMIT @limit`
      )
      .all(params) as Row[];
  }
}

function hygieneRecommendations(lowSalienceActive: number, archiveLowSalienceAfterDays: number, duplicateCandidates: number, attributionCandidates: number): string[] {
  const recommendations: string[] = [];
  if (lowSalienceActive > 500) {
    recommendations.push(
      `Review the low-salience backlog by project; consider ccm hygiene run --dry-run --older-than-days ${archiveLowSalienceAfterDays} before publishing effectiveness examples.`
    );
  }
  if (lowSalienceActive > 0) {
    recommendations.push("Prefer archiving repeated low-salience hook noise over deleting it so audit history remains available.");
  }
  if (duplicateCandidates > 0) {
    recommendations.push("Run duplicate/handoff hygiene to archive repeated compact-session summaries and exact duplicate memories.");
  }
  if (attributionCandidates > 0) {
    recommendations.push("Run attribution repair to move cross-project memories or loops to the project they actually describe.");
  }
  return recommendations;
}

function memoryFingerprint(summary: string, content: string): string | undefined {
  const normalized = `${summary}\n${content}`
    .toLowerCase()
    .replace(/memory_[a-z0-9_-]+|event_[a-z0-9_-]+|trace_[a-z0-9_-]+/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 80) return undefined;
  return createHash("sha256").update(normalized.slice(0, 2000)).digest("hex");
}

function isHandoffRow(row: Row): boolean {
  return String(row.summary ?? "").includes("Compacted Codex session handoff") || String(row.tags_json ?? "").includes("compact_session");
}
