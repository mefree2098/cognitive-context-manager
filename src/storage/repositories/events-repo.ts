import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { EventCapsule, EventType } from "../../types/event.js";
import { json, nowIso, parseJson, Row, text } from "./row-utils.js";

function mapEvent(row: Row): EventCapsule {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    projectId: text(row.project_id),
    eventType: String(row.event_type) as EventType,
    title: text(row.title),
    summary: String(row.summary),
    entities: parseJson<string[]>(row.entities_json, []),
    sourceRefs: parseJson(row.source_refs_json, []),
    salience: Number(row.salience),
    confidence: Number(row.confidence),
    createdAt: String(row.created_at)
  };
}

export class EventsRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: Omit<EventCapsule, "id" | "createdAt"> & Partial<Pick<EventCapsule, "id" | "createdAt">>): EventCapsule {
    const event: EventCapsule = {
      ...input,
      id: input.id ?? `event_${nanoid(12)}`,
      createdAt: input.createdAt ?? nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO events(id, session_id, project_id, event_type, title, summary, entities_json, source_refs_json, salience, confidence, created_at)
         VALUES (@id, @sessionId, @projectId, @eventType, @title, @summary, @entitiesJson, @sourceRefsJson, @salience, @confidence, @createdAt)`
      )
      .run({
        id: event.id,
        sessionId: event.sessionId,
        projectId: event.projectId,
        eventType: event.eventType,
        title: event.title,
        summary: event.summary,
        entitiesJson: json(event.entities),
        sourceRefsJson: json(event.sourceRefs),
        salience: event.salience,
        confidence: event.confidence,
        createdAt: event.createdAt
      });
    this.db
      .prepare("INSERT INTO events_fts(id, summary, title) VALUES (?, ?, ?)")
      .run(event.id, event.summary, event.title ?? "");
    return event;
  }

  recent(projectId?: string, limit = 10, eventTypes?: EventType[], minSalience = 0): EventCapsule[] {
    const clauses = ["salience >= @minSalience"];
    const params: Record<string, unknown> = { minSalience, limit };
    if (projectId) {
      clauses.push("project_id = @projectId");
      params.projectId = projectId;
    }
    if (eventTypes?.length) {
      clauses.push(`event_type IN (${eventTypes.map((_, index) => `@eventType${index}`).join(", ")})`);
      eventTypes.forEach((eventType, index) => {
        params[`eventType${index}`] = eventType;
      });
    }
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT @limit`)
      .all(params) as Row[];
    return rows.map(mapEvent);
  }
}
