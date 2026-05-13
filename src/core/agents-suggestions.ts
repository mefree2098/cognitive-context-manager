import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { json, nowIso, parseJson, Row } from "../storage/repositories/row-utils.js";
import { detectProject } from "./project-detector.js";
import { redactSecrets } from "./secret-redactor.js";

export interface AgentsSuggestion {
  id: string;
  projectId?: string;
  reason: string;
  candidateInstruction: string;
  evidenceMemoryIds: string[];
  diff: string;
  status: "pending_user_review" | "applied" | "rejected";
  createdAt: string;
  updatedAt: string;
}

function mapSuggestion(row: Row): AgentsSuggestion {
  return {
    id: String(row.id),
    projectId: typeof row.project_id === "string" ? row.project_id : undefined,
    reason: String(row.reason),
    candidateInstruction: String(row.candidate_instruction),
    evidenceMemoryIds: parseJson<string[]>(row.evidence_memory_ids_json, []),
    diff: String(row.diff),
    status: String(row.status) as AgentsSuggestion["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class AgentsSuggestionService {
  constructor(private readonly db: Database.Database) {}

  suggest(input: {
    projectId?: string;
    repoPath?: string;
    reason: string;
    candidateInstruction: string;
    evidenceMemoryIds?: string[];
  }): AgentsSuggestion {
    const project = input.projectId ? undefined : detectProject(input.repoPath ?? process.cwd());
    const projectId = input.projectId ?? project?.id ?? detectProject(input.repoPath ?? process.cwd()).id;
    const instruction = redactSecrets(input.candidateInstruction).text;
    const diff = buildAgentsDiff(input.repoPath ?? process.cwd(), instruction);
    const now = nowIso();
    const id = `agents_${nanoid(12)}`;
    this.db
      .prepare(
        `INSERT INTO agents_suggestions(id, project_id, reason, candidate_instruction, evidence_memory_ids_json, diff, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_user_review', ?, ?)`
      )
      .run(id, projectId, redactSecrets(input.reason).text, instruction, json(input.evidenceMemoryIds ?? []), diff, now, now);
    return this.get(id)!;
  }

  list(projectId?: string): AgentsSuggestion[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM agents_suggestions WHERE project_id = ? ORDER BY created_at DESC")
          .all(projectId) as Row[])
      : (this.db.prepare("SELECT * FROM agents_suggestions ORDER BY created_at DESC").all() as Row[]);
    return rows.map(mapSuggestion);
  }

  get(id: string): AgentsSuggestion | undefined {
    const row = this.db.prepare("SELECT * FROM agents_suggestions WHERE id = ?").get(id) as Row | undefined;
    return row ? mapSuggestion(row) : undefined;
  }

  apply(id: string, repoPath = process.cwd()): AgentsSuggestion {
    const suggestion = this.get(id);
    if (!suggestion) throw new Error(`Suggestion not found: ${id}`);
    const agentsPath = join(repoPath, "AGENTS.md");
    const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "# AGENTS.md\n\n";
    if (!existing.includes(suggestion.candidateInstruction)) {
      writeFileSync(
        agentsPath,
        `${existing.trimEnd()}\n\n## Cognitive Context Manager Suggestions\n\n- ${suggestion.candidateInstruction}\n`,
        "utf8"
      );
    }
    this.db.prepare("UPDATE agents_suggestions SET status = 'applied', updated_at = ? WHERE id = ?").run(nowIso(), id);
    return this.get(id)!;
  }

  reject(id: string): AgentsSuggestion {
    const suggestion = this.get(id);
    if (!suggestion) throw new Error(`Suggestion not found: ${id}`);
    this.db.prepare("UPDATE agents_suggestions SET status = 'rejected', updated_at = ? WHERE id = ?").run(nowIso(), id);
    return this.get(id)!;
  }
}

function buildAgentsDiff(repoPath: string, instruction: string): string {
  const agentsPath = join(repoPath, "AGENTS.md");
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8").trimEnd() : "# AGENTS.md";
  return [
    "--- AGENTS.md",
    "+++ AGENTS.md",
    "@@",
    existing.split(/\r?\n/).slice(-3).map((line) => ` ${line}`).join("\n"),
    "+",
    "+## Cognitive Context Manager Suggestions",
    `+- ${instruction}`
  ].join("\n");
}
