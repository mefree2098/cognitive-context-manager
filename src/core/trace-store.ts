import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import { json, nowIso, parseJson, Row } from "../storage/repositories/row-utils.js";
import { estimateTokens } from "./tokenizer.js";

export interface TraceEntry {
  id: string;
  projectId?: string;
  sessionId?: string;
  traceType: "hook" | "retrieval" | "mcp" | "daemon" | "sync" | "hygiene" | "agents" | "benchmark";
  title?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RetrievalExplanation {
  selected: Array<{ id: string; reason: string; tokenEstimate: number }>;
  excluded: Array<{ id: string; reason: string }>;
  budget: {
    softLimit: number;
    hardLimit: number;
    used: number;
  };
  stats: {
    candidateMemories: number;
    selectedMemories: number;
    excludedSuperseded: number;
    excludedOverBudget: number;
    excludedLowRelevance: number;
  };
}

function mapTrace(row: Row): TraceEntry {
  return {
    id: String(row.id),
    projectId: typeof row.project_id === "string" ? row.project_id : undefined,
    sessionId: typeof row.session_id === "string" ? row.session_id : undefined,
    traceType: String(row.trace_type) as TraceEntry["traceType"],
    title: typeof row.title === "string" ? row.title : undefined,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: String(row.created_at)
  };
}

export class TraceStore {
  constructor(private readonly db: Database.Database) {}

  record(input: Omit<TraceEntry, "id" | "createdAt">): TraceEntry {
    const entry: TraceEntry = {
      ...input,
      id: `trace_${nanoid(12)}`,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO trace_entries(id, project_id, session_id, trace_type, title, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.projectId, entry.sessionId, entry.traceType, entry.title, json(entry.payload), entry.createdAt);
    return entry;
  }

  latest(traceType?: TraceEntry["traceType"]): TraceEntry | undefined {
    const row = traceType
      ? (this.db
          .prepare("SELECT * FROM trace_entries WHERE trace_type = ? ORDER BY created_at DESC LIMIT 1")
          .get(traceType) as Row | undefined)
      : (this.db.prepare("SELECT * FROM trace_entries ORDER BY created_at DESC LIMIT 1").get() as Row | undefined);
    return row ? mapTrace(row) : undefined;
  }

  list(limit = 20, traceType?: TraceEntry["traceType"]): TraceEntry[] {
    const rows = traceType
      ? (this.db
          .prepare("SELECT * FROM trace_entries WHERE trace_type = ? ORDER BY created_at DESC LIMIT ?")
          .all(traceType, limit) as Row[])
      : (this.db.prepare("SELECT * FROM trace_entries ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]);
    return rows.map(mapTrace);
  }
}

export function buildRetrievalExplanation(input: {
  candidates: Array<{ id: string; staleStatus?: string; summary?: string; content?: string; retrievalReason?: string; retrievalScore?: number }>;
  selectedIds: string[];
  renderedBrief: string;
  softLimit: number;
  hardLimit: number;
}): RetrievalExplanation {
  const selectedSet = new Set(input.selectedIds);
  let excludedSuperseded = 0;
  let excludedOverBudget = 0;
  let excludedLowRelevance = 0;
  const selected = input.candidates
    .filter((memory) => selectedSet.has(memory.id))
    .map((memory) => ({
      id: memory.id,
      reason: memory.retrievalReason ?? `selected with score ${memory.retrievalScore?.toFixed(3) ?? "n/a"}`,
      tokenEstimate: estimateTokens(memory.summary || memory.content || "")
    }));
  const excluded = input.candidates
    .filter((memory) => !selectedSet.has(memory.id))
    .map((memory) => {
      let reason = "low relevance after reranking";
      if (memory.staleStatus && memory.staleStatus !== "active") {
        reason = `excluded because memory is ${memory.staleStatus}`;
        excludedSuperseded += 1;
      } else if (estimateTokens(input.renderedBrief) >= input.hardLimit) {
        reason = "excluded over token budget";
        excludedOverBudget += 1;
      } else {
        excludedLowRelevance += 1;
      }
      return { id: memory.id, reason };
    });

  return {
    selected,
    excluded,
    budget: {
      softLimit: input.softLimit,
      hardLimit: input.hardLimit,
      used: estimateTokens(input.renderedBrief)
    },
    stats: {
      candidateMemories: input.candidates.length,
      selectedMemories: selected.length,
      excludedSuperseded,
      excludedOverBudget,
      excludedLowRelevance
    }
  };
}
