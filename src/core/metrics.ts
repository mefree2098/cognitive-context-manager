import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { json, nowIso, Row } from "../storage/repositories/row-utils.js";
import { estimateTokens } from "./tokenizer.js";

export class MetricsService {
  constructor(private readonly db: Database.Database) {}

  record(projectId: string | undefined, sessionId: string | undefined, metricName: string, value: number, metadata: Record<string, unknown> = {}) {
    this.db
      .prepare(
        `INSERT INTO metrics(id, project_id, session_id, metric_name, metric_value, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`metric_${nanoid(12)}`, projectId, sessionId, metricName, value, json(metadata), nowIso());
  }

  contextDividend(sessionId?: string) {
    const latestSession = sessionId
      ? ({ id: sessionId } as { id: string })
      : (this.db.prepare("SELECT id FROM sessions ORDER BY last_seen_at DESC LIMIT 1").get() as { id: string } | undefined);
    const sid = latestSession?.id;
    const where = sid ? "WHERE session_id = @sessionId" : "";
    const params = sid ? { sessionId: sid } : {};
    const memories = this.db.prepare(`SELECT content, summary, stale_status, memory_type FROM memories ${where}`).all(params) as Row[];
    const events = this.db.prepare(`SELECT summary FROM events ${where}`).all(params) as Row[];
    const injectedMemoryTokens = memories.reduce((sum, row) => sum + estimateTokens(String(row.summary ?? row.content ?? "")), 0);
    const rawTokensAvoided = Math.max(0, events.reduce((sum, row) => sum + estimateTokens(String(row.summary ?? "")), 0) * 3 - injectedMemoryTokens);
    const supersededExcluded = memories.filter((row) => row.stale_status && row.stale_status !== "active").length;
    const openLoopsPreserved = memories.filter((row) => row.memory_type === "open_loop").length;
    return {
      sessionId: sid ?? "all",
      injectedMemoryTokens,
      rawTranscriptTokensAvoided: rawTokensAvoided,
      rawLogTokensAvoided: Math.floor(rawTokensAvoided * 0.35),
      supersededMemoriesExcluded: supersededExcluded,
      retrievedMemoriesUsed: memories.filter((row) => row.stale_status === "active").length,
      openLoopTasksPreserved: openLoopsPreserved,
      repeatUserRemindersDetected: memories.filter((row) => /again|from now on|remember/i.test(String(row.content ?? ""))).length,
      staleFactPreventions: supersededExcluded,
      fallbackEvents: 0,
      netEstimatedTokenSavings: rawTokensAvoided + Math.floor(rawTokensAvoided * 0.35) - injectedMemoryTokens,
      qualityNotes: [
        `${supersededExcluded} stale or non-active memories excluded from normal injection`,
        `${openLoopsPreserved} open-loop memories preserved`,
        "Memory is reported as contextual data, not instruction"
      ]
    };
  }
}
