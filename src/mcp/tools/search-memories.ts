import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, memoryTypeSchema, optionalString } from "./common.js";

export const searchMemoriesSchema = {
  query: z.string().min(1),
  projectId: optionalString,
  memoryTypes: z.array(memoryTypeSchema).optional(),
  limit: z.number().int().positive().max(50).default(10),
  includeStale: z.boolean().default(false)
};

export function searchMemories(service: CcmService, input: z.infer<z.ZodObject<typeof searchMemoriesSchema>>) {
  return {
    results: service.searchMemories(input).map((memory) => ({
      id: memory.id,
      memoryType: memory.memoryType,
      summary: memory.summary,
      content: memory.content,
      confidence: memory.confidence,
      salience: memory.salience,
      staleStatus: memory.staleStatus,
      sourceRefs: memory.sourceRefs
    }))
  };
}

export function registerSearchMemories(server: any, service: CcmService): void {
  server.tool(
    "search_memories",
    "Search active or stale memories with project/type filters.",
    searchMemoriesSchema,
    async (input: z.infer<z.ZodObject<typeof searchMemoriesSchema>>) => jsonContent(searchMemories(service, input))
  );
}
