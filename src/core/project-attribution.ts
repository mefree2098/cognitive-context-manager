import { basename } from "node:path";
import type Database from "better-sqlite3";
import type { ProjectSummary } from "../types/project.js";
import { ProjectsRepo } from "../storage/repositories/projects-repo.js";

export interface ProjectAttribution {
  project: ProjectSummary;
  confidence: number;
  reasons: string[];
}

export interface AttributionRepairAction {
  targetType: "open_loop" | "memory";
  targetId: string;
  fromProjectId?: string;
  toProjectId: string;
  confidence: number;
  reason: string;
}

const GENERIC_ALIASES = new Set(["project", "context", "memories", "codex", "skills", "main", "app", "src"]);

export class ProjectAttributionService {
  constructor(private readonly db: Database.Database) {}

  inferProject(text: string, fallbackProjectId?: string, minConfidence = 0.72): ProjectAttribution | undefined {
    const normalizedText = normalize(text);
    if (!normalizedText) return undefined;
    const projects = new ProjectsRepo(this.db).listProjects(200);
    const scored = projects
      .map((project) => scoreProject(project, normalizedText))
      .filter((item) => item.confidence >= minConfidence)
      .sort((left, right) => right.confidence - left.confidence || Number(left.project.id === fallbackProjectId) - Number(right.project.id === fallbackProjectId));
    return scored[0];
  }

  attributionPlan(options: { minConfidence?: number; limit?: number; includeMemories?: boolean } = {}): AttributionRepairAction[] {
    const minConfidence = options.minConfidence ?? 0.78;
    const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
    return [
      ...this.openLoopPlan(minConfidence, limit),
      ...(options.includeMemories ? this.memoryPlan(Math.max(0.94, minConfidence), limit) : [])
    ].slice(0, limit);
  }

  repairAttribution(dryRun = true, options: { minConfidence?: number; limit?: number; includeMemories?: boolean } = {}) {
    const actions = this.attributionPlan(options);
    if (!dryRun) {
      const updateOpenLoop = this.db.prepare("UPDATE open_loops SET project_id = ?, updated_at = ? WHERE id = ?");
      const updateMemory = this.db.prepare("UPDATE memories SET project_id = ?, updated_at = ? WHERE id = ?");
      const now = new Date().toISOString();
      const apply = this.db.transaction((items: AttributionRepairAction[]) => {
        for (const action of items) {
          if (action.targetType === "open_loop") updateOpenLoop.run(action.toProjectId, now, action.targetId);
          else updateMemory.run(action.toProjectId, now, action.targetId);
        }
      });
      apply(actions);
    }
    return { dryRun, actions };
  }

  private openLoopPlan(minConfidence: number, limit: number): AttributionRepairAction[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, title, description
         FROM open_loops
         WHERE status IN ('open', 'blocked')
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ id: string; project_id?: string; title: string; description: string }>;
    return rows.flatMap((row) => {
      const inferred = this.inferProject(`${row.title}\n${row.title}\n${row.description}`, row.project_id, minConfidence);
      if (!inferred || inferred.project.id === row.project_id) return [];
      return [
        {
          targetType: "open_loop" as const,
          targetId: row.id,
          fromProjectId: row.project_id,
          toProjectId: inferred.project.id,
          confidence: inferred.confidence,
          reason: inferred.reasons.join("; ")
        }
      ];
    });
  }

  private memoryPlan(minConfidence: number, limit: number): AttributionRepairAction[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, summary, content
         FROM memories
         WHERE stale_status = 'active'
           AND (tags_json LIKE '%decision%' OR tags_json LIKE '%handoff%' OR memory_type IN ('semantic', 'open_loop'))
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ id: string; project_id?: string; summary?: string; content: string }>;
    return rows.flatMap((row) => {
      const inferred = this.inferProject(`${row.summary ?? ""}\n${row.content}`, row.project_id, minConfidence);
      if (!inferred || inferred.project.id === row.project_id) return [];
      return [
        {
          targetType: "memory" as const,
          targetId: row.id,
          fromProjectId: row.project_id,
          toProjectId: inferred.project.id,
          confidence: inferred.confidence,
          reason: inferred.reasons.join("; ")
        }
      ];
    });
  }
}

function scoreProject(project: ProjectSummary, normalizedText: string): ProjectAttribution {
  const reasons: string[] = [];
  let confidence = 0;
  const root = project.rootPath ? normalize(project.rootPath) : "";
  if (root && normalizedText.includes(root)) {
    confidence = Math.max(confidence, 0.98);
    reasons.push(`matched root path ${project.rootPath}`);
  }
  for (const alias of projectAliases(project)) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias || normalizedAlias.length < 4 || GENERIC_ALIASES.has(normalizedAlias)) continue;
    if (containsToken(normalizedText, normalizedAlias)) {
      const occurrences = countOccurrences(normalizedText, normalizedAlias);
      const earlyBoost = normalizedText.slice(0, 220).includes(normalizedAlias) ? 0.04 : 0;
      const aliasScore = (normalizedAlias.length >= 8 ? 0.9 : 0.82) + Math.min(0.06, Math.max(0, occurrences - 1) * 0.03) + earlyBoost;
      confidence = Math.max(confidence, aliasScore);
      reasons.push(`matched project alias ${alias}`);
    }
  }
  return { project, confidence, reasons };
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function projectAliases(project: ProjectSummary): string[] {
  const aliases = [project.name];
  if (project.rootPath) aliases.push(basename(project.rootPath));
  if (project.gitRemote) aliases.push(project.gitRemote.replace(/\.git$/i, "").split(/[/:]/).at(-1) ?? "");
  return [...new Set(aliases.filter(Boolean))];
}

function containsToken(text: string, alias: string): boolean {
  if (text.includes(alias)) return true;
  const dashed = alias.replace(/\s+/g, "-");
  const spaced = alias.replace(/[-_]+/g, " ");
  return text.includes(dashed) || text.includes(spaced);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
