import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const markStaleSchema = {
  memoryId: z.string().min(1),
  reason: z.string().min(1),
  supersededBy: optionalString
};

export function markStale(service: CcmService, input: z.infer<z.ZodObject<typeof markStaleSchema>>) {
  const memory = service.memories.markStale(input.memoryId, input.supersededBy ? "superseded" : "stale", input.reason, input.supersededBy);
  return { memory, ok: Boolean(memory) };
}

export function registerMarkStale(server: any, service: CcmService): void {
  server.tool(
    "mark_stale",
    "Mark a memory stale or superseded when current evidence contradicts it.",
    markStaleSchema,
    async (input: z.infer<z.ZodObject<typeof markStaleSchema>>) => jsonContent(markStale(service, input))
  );
}
