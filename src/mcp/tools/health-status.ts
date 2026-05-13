import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent } from "./common.js";

export const emptySchema = {};

export function registerHealthStatus(server: any, service: CcmService): void {
  server.tool("get_memory_health", "Return memory hygiene and retention health.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.memoryHealth()));
  server.tool("get_sync_status", "Return optional sync status.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.syncStatus()));
  server.tool("get_embedding_status", "Return optional embedding provider and queue status.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.embeddingStatus()));
  server.tool("get_context_dividend", "Return context dividend metrics.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.contextDividend()));
}
