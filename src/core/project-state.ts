import type Database from "better-sqlite3";
import type { EventCapsule } from "../types/event.js";
import { EventsRepo } from "../storage/repositories/events-repo.js";
import { MemoriesRepo } from "../storage/repositories/memories-repo.js";
import { OpenLoopsRepo } from "../storage/repositories/open-loops-repo.js";
import { ProjectsRepo } from "../storage/repositories/projects-repo.js";
import { nowIso, Row } from "../storage/repositories/row-utils.js";
import { redactSecrets } from "./secret-redactor.js";

export class ProjectStateService {
  constructor(private readonly db: Database.Database) {}

  update(projectId?: string, sessionId?: string): string | undefined {
    if (!projectId) return undefined;
    const projects = new ProjectsRepo(this.db);
    const project = projects.get(projectId);
    if (!project) return undefined;
    const events = new EventsRepo(this.db).recent(projectId, 12);
    const loops = new OpenLoopsRepo(this.db).list(projectId, false, 6);
    const decisions = events.filter((event) => event.eventType === "decision").slice(0, 5);
    const outcomes = events.filter((event) => event.eventType === "outcome" || /^Outcome:/.test(event.title ?? "")).slice(0, 6);
    const blockers = loops.filter((loop) => loop.priority <= 2 || /\b(block|stuck|fail|needs?)\b/i.test(`${loop.title} ${loop.description}`));
    const content = [
      `Project: ${project.name}`,
      `Root: ${project.rootPath ?? "unknown"}`,
      "",
      "Current goal:",
      latestMeaningful(events)?.summary ?? "No current goal captured yet.",
      "",
      "Last verified state:",
      outcomes[0]?.summary ?? "No explicit outcome captured yet.",
      "",
      "Active blockers:",
      blockers.length ? blockers.map((loop) => `- ${loop.title}: ${loop.description}`).join("\n") : "- None recorded.",
      "",
      "Next action:",
      loops[0] ? `${loops[0].title}: ${loops[0].description}` : "Continue from latest verified state.",
      "",
      "Known decisions:",
      decisions.length ? decisions.map((event) => `- ${event.summary}`).join("\n") : "- None recorded."
    ].join("\n");
    return this.upsertStateMemory(projectId, sessionId, content);
  }

  private upsertStateMemory(projectId: string, sessionId: string | undefined, content: string): string {
    const redacted = redactSecrets(content).text;
    const existing = this.db
      .prepare("SELECT id, content FROM memories WHERE project_id = ? AND stale_status = 'active' AND tags_json LIKE '%project_state%' ORDER BY updated_at DESC LIMIT 1")
      .get(projectId) as Row | undefined;
    if (existing && String(existing.content) === redacted) return String(existing.id);
    if (existing) {
      const now = nowIso();
      this.db
        .prepare(
          `UPDATE memories
           SET content = ?, summary = 'Rolling project state', session_id = COALESCE(?, session_id), updated_at = ?, salience = 0.92, confidence = 0.82
           WHERE id = ?`
        )
        .run(redacted, sessionId, now, existing.id);
      this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(existing.id);
      this.db.prepare("INSERT INTO memories_fts(id, content, summary, tags) VALUES (?, ?, ?, ?)").run(existing.id, redacted, "Rolling project state", "project_state rolling_state");
      return String(existing.id);
    }
    return new MemoriesRepo(this.db).create({
      projectId,
      sessionId,
      memoryType: "semantic",
      eventType: "implementation_step",
      content: redacted,
      summary: "Rolling project state",
      tags: ["project_state", "rolling_state"],
      retrievalCues: ["project state", "current goal", "last verified state", "next action"],
      salience: 0.92,
      confidence: 0.82,
      decayPolicy: "project_long_term",
      sourceRefs: [{ kind: "system", label: "project_state_update", timestamp: new Date().toISOString() }]
    }).id;
  }
}

function latestMeaningful(events: EventCapsule[]): EventCapsule | undefined {
  return events.find((event) => !["session_start", "session_stop"].includes(event.eventType));
}
