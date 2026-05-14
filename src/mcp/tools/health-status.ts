import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent } from "./common.js";

export const emptySchema = {};
const effectivenessReportSchema = {
  since: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  sampleLimit: z.number().optional()
};

export function registerHealthStatus(server: any, service: CcmService): void {
  server.tool("get_memory_health", "Return memory hygiene and retention health.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.memoryHealth()));
  server.tool("get_sync_status", "Return optional sync status.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.syncStatus()));
  server.tool("get_embedding_status", "Return optional embedding provider and queue status.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.embeddingStatus()));
  server.tool("get_context_dividend", "Return context dividend metrics.", emptySchema, async (_input: z.infer<z.ZodObject<typeof emptySchema>>) => jsonContent(service.contextDividend()));
  server.tool("get_effectiveness_report", "Return local CCM effectiveness and publishing-readiness metrics.", effectivenessReportSchema, async (input: z.infer<z.ZodObject<typeof effectivenessReportSchema>>) => jsonContent(service.effectivenessReport(input)));
}
