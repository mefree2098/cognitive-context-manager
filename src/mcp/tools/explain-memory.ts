import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { rankMemories } from "../../core/retrieval-planner.js";
import { jsonContent, optionalString } from "./common.js";

export const explainMemorySchema = {
  memoryId: z.string().min(1),
  query: optionalString
};

export function explainMemory(service: CcmService, input: z.infer<z.ZodObject<typeof explainMemorySchema>>) {
  const memory = service.memories.get(input.memoryId);
  if (!memory) return { ok: false, reason: "Memory not found" };
  const ranked = rankMemories([memory], input.query ?? memory.summary ?? memory.content)[0];
  return {
    ok: true,
    memory,
    retrievalScore: ranked.retrievalScore,
    retrievalReason: ranked.retrievalReason,
    staleness: memory.staleStatus,
    provenance: memory.sourceRefs
  };
}

export function registerExplainMemory(server: any, service: CcmService): void {
  server.tool(
    "explain_memory",
    "Explain why a memory was retrieved and show scoring factors.",
    explainMemorySchema,
    async (input: z.infer<z.ZodObject<typeof explainMemorySchema>>) => jsonContent(explainMemory(service, input))
  );
}
