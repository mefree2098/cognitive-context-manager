import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

const eventTypeSchema = z.enum([
  "session_start",
  "user_prompt",
  "tool_use",
  "tool_result",
  "decision",
  "preference",
  "failure",
  "blocker",
  "artifact_change",
  "test_result",
  "implementation_step",
  "topic_shift",
  "session_stop"
]);

export const getRecentEventsSchema = {
  projectId: optionalString,
  eventTypes: z.array(eventTypeSchema).optional(),
  minSalience: z.number().min(0).max(1).default(0),
  limit: z.number().int().positive().max(50).default(10)
};

export function getRecentEvents(service: CcmService, input: z.infer<z.ZodObject<typeof getRecentEventsSchema>>) {
  return { events: service.events.recent(input.projectId, input.limit, input.eventTypes, input.minSalience) };
}

export function registerGetRecentEvents(server: any, service: CcmService): void {
  server.tool(
    "get_recent_events",
    "Return recent session events with filters.",
    getRecentEventsSchema,
    async (input: z.infer<z.ZodObject<typeof getRecentEventsSchema>>) => jsonContent(getRecentEvents(service, input))
  );
}
