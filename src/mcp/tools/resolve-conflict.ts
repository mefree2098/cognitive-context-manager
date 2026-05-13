import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const resolveConflictSchema = {
  conflictId: z.string().min(1),
  resolution: z.string().min(1),
  preferredMemoryId: optionalString
};

export function resolveConflict(service: CcmService, input: z.infer<z.ZodObject<typeof resolveConflictSchema>>) {
  const conflict = service.conflicts.resolve(input.conflictId, input.resolution);
  if (input.preferredMemoryId && conflict) {
    const other = conflict.memoryA === input.preferredMemoryId ? conflict.memoryB : conflict.memoryA;
    service.memories.markStale(other, "superseded", `Conflict ${conflict.id} resolved in favor of ${input.preferredMemoryId}`, input.preferredMemoryId);
  }
  return { conflict, ok: Boolean(conflict) };
}

export function registerResolveConflict(server: any, service: CcmService): void {
  server.tool(
    "resolve_conflict",
    "Resolve a memory conflict and optionally prefer one memory.",
    resolveConflictSchema,
    async (input: z.infer<z.ZodObject<typeof resolveConflictSchema>>) => jsonContent(resolveConflict(service, input))
  );
}
