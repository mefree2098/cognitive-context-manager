import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { EventType } from "../../types/event.js";
import type { DecayPolicy, Memory, MemorySearchOptions, MemoryType, StaleStatus } from "../../types/memory.js";
import { redactSecrets } from "../../core/secret-redactor.js";
import { json, nowIso, parseJson, Row, text } from "./row-utils.js";

function mapMemory(row: Row): Memory {
  return {
    id: String(row.id),
    projectId: text(row.project_id),
    sessionId: text(row.session_id),
    memoryType: String(row.memory_type) as MemoryType,
    eventType: text(row.event_type) as EventType | undefined,
    content: String(row.content),
    summary: text(row.summary),
    entities: parseJson<string[]>(row.entities_json, []),
    tags: parseJson<string[]>(row.tags_json, []),
    retrievalCues: parseJson<string[]>(row.retrieval_cues_json, []),
    salience: Number(row.salience),
    confidence: Number(row.confidence),
    sourceRefs: parseJson(row.source_refs_json, []),
    supersedes: parseJson<string[]>(row.supersedes_json, []),
    supersededBy: text(row.superseded_by),
    staleStatus: String(row.stale_status) as StaleStatus,
    decayPolicy: String(row.decay_policy) as DecayPolicy,
    validFrom: String(row.valid_from),
    validUntil: text(row.valid_until),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function ftsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/[^A-Za-z0-9_./-]/g, ""))
    .filter(Boolean)
    .slice(0, 12);
  return terms.length ? terms.map((term) => `"${term}"`).join(" OR ") : "\"\"";
}

export class MemoriesRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: Partial<Memory> & Pick<Memory, "memoryType" | "content">): Memory {
    const now = nowIso();
    const redacted = redactSecrets(input.content);
    const summary = input.summary ? redactSecrets(input.summary).text : redacted.text.slice(0, 240);
    const memory: Memory = {
      id: input.id ?? `memory_${nanoid(12)}`,
      projectId: input.projectId,
      sessionId: input.sessionId,
      memoryType: input.memoryType,
      eventType: input.eventType,
      content: redacted.text,
      summary,
      entities: input.entities ?? [],
      tags: [...new Set([...(input.tags ?? []), ...redacted.redactions.map((item) => `redacted:${item}`)])],
      retrievalCues: input.retrievalCues ?? [],
      salience: input.salience ?? 0.5,
      confidence: input.confidence ?? 0.75,
      sourceRefs: input.sourceRefs ?? [],
      supersedes: input.supersedes ?? [],
      supersededBy: input.supersededBy,
      staleStatus: input.staleStatus ?? "active",
      decayPolicy: input.decayPolicy ?? "normal",
      validFrom: input.validFrom ?? now,
      validUntil: input.validUntil,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    };

    this.db
      .prepare(
        `INSERT INTO memories(
          id, project_id, session_id, memory_type, event_type, content, summary,
          entities_json, tags_json, retrieval_cues_json, salience, confidence,
          source_refs_json, supersedes_json, superseded_by, stale_status, decay_policy,
          valid_from, valid_until, created_at, updated_at
        ) VALUES (
          @id, @projectId, @sessionId, @memoryType, @eventType, @content, @summary,
          @entitiesJson, @tagsJson, @retrievalCuesJson, @salience, @confidence,
          @sourceRefsJson, @supersedesJson, @supersededBy, @staleStatus, @decayPolicy,
          @validFrom, @validUntil, @createdAt, @updatedAt
        )`
      )
      .run({
        id: memory.id,
        projectId: memory.projectId,
        sessionId: memory.sessionId,
        memoryType: memory.memoryType,
        eventType: memory.eventType,
        content: memory.content,
        summary: memory.summary,
        entitiesJson: json(memory.entities),
        tagsJson: json(memory.tags),
        retrievalCuesJson: json(memory.retrievalCues),
        salience: memory.salience,
        confidence: memory.confidence,
        sourceRefsJson: json(memory.sourceRefs),
        supersedesJson: json(memory.supersedes),
        supersededBy: memory.supersededBy,
        staleStatus: memory.staleStatus,
        decayPolicy: memory.decayPolicy,
        validFrom: memory.validFrom,
        validUntil: memory.validUntil,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt
      });

    this.db
      .prepare("INSERT INTO memories_fts(id, content, summary, tags) VALUES (?, ?, ?, ?)")
      .run(memory.id, memory.content, memory.summary ?? "", memory.tags.join(" "));

    for (const supersededId of memory.supersedes) {
      this.markStale(supersededId, "superseded", `Superseded by ${memory.id}`, memory.id);
    }

    return memory;
  }

  get(id: string): Memory | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Row | undefined;
    return row ? mapMemory(row) : undefined;
  }

  list(limit = 20, projectId?: string): Memory[] {
    const rows = projectId
      ? (this.db
          .prepare("SELECT * FROM memories WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?")
          .all(projectId, limit) as Row[])
      : (this.db.prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?").all(limit) as Row[]);
    return rows.map(mapMemory);
  }

  search(options: MemorySearchOptions): Memory[] {
    const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
    const params: Record<string, unknown> = { limit };
    const clauses: string[] = [];
    if (options.projectId) {
      clauses.push("m.project_id = @projectId");
      params.projectId = options.projectId;
    }
    if (!options.includeStale) {
      clauses.push("m.stale_status = 'active'");
    }
    if (options.memoryTypes?.length) {
      clauses.push(`m.memory_type IN (${options.memoryTypes.map((_, index) => `@type${index}`).join(", ")})`);
      options.memoryTypes.forEach((type, index) => {
        params[`type${index}`] = type;
      });
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const query = options.query.trim();
    if (query) {
      try {
        const rows = this.db
          .prepare(
            `SELECT m.*, bm25(memories_fts) AS rank
             FROM memories_fts f
             JOIN memories m ON m.id = f.id
             ${where ? `${where} AND` : "WHERE"} memories_fts MATCH @query
             ORDER BY rank ASC, m.salience DESC, m.confidence DESC, m.updated_at DESC
             LIMIT @limit`
          )
          .all({ ...params, query: ftsQuery(query) }) as Row[];
        return rows.map(mapMemory);
      } catch {
        const like = `%${query}%`;
        const rows = this.db
          .prepare(
            `SELECT m.* FROM memories m
             ${where ? `${where} AND` : "WHERE"} (m.content LIKE @like OR m.summary LIKE @like OR m.tags_json LIKE @like)
             ORDER BY m.salience DESC, m.confidence DESC, m.updated_at DESC
             LIMIT @limit`
          )
          .all({ ...params, like }) as Row[];
        return rows.map(mapMemory);
      }
    }

    const rows = this.db
      .prepare(`SELECT m.* FROM memories m ${where} ORDER BY m.salience DESC, m.confidence DESC, m.updated_at DESC LIMIT @limit`)
      .all(params) as Row[];
    return rows.map(mapMemory);
  }

  markStale(id: string, staleStatus: Exclude<StaleStatus, "active" | "forgotten">, reason: string, supersededBy?: string): Memory | undefined {
    const memory = this.get(id);
    if (!memory) return undefined;
    const tags = [...new Set([...memory.tags, `stale:${staleStatus}`])];
    this.db
      .prepare(
        `UPDATE memories
         SET stale_status = ?, superseded_by = COALESCE(?, superseded_by), tags_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(staleStatus, supersededBy, json(tags), nowIso(), id);
    if (reason) {
      this.create({
        projectId: memory.projectId,
        sessionId: memory.sessionId,
        memoryType: "salience",
        eventType: "implementation_step",
        content: `Memory ${id} marked ${staleStatus}: ${reason}`,
        summary: `Marked ${id} ${staleStatus}`,
        tags: ["staleness"],
        salience: 0.65,
        confidence: 0.8,
        sourceRefs: [{ kind: "memory", label: id }]
      });
    }
    return this.get(id);
  }

  forget(id: string, hardDelete = false): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    if (hardDelete) {
      this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
      return true;
    }
    this.db
      .prepare(
        `UPDATE memories
         SET stale_status = 'forgotten', content = '[forgotten]', summary = 'Forgotten memory tombstone', updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), id);
    this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
    return true;
  }

  countsByType(projectId?: string): Record<string, number> {
    const rows = projectId
      ? (this.db
          .prepare("SELECT memory_type, COUNT(*) AS count FROM memories WHERE project_id = ? GROUP BY memory_type")
          .all(projectId) as Row[])
      : (this.db.prepare("SELECT memory_type, COUNT(*) AS count FROM memories GROUP BY memory_type").all() as Row[]);
    return Object.fromEntries(rows.map((row) => [String(row.memory_type), Number(row.count)]));
  }
}
