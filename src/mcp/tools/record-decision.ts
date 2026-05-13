import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const recordDecisionSchema = {
  decision: z.string().min(1),
  rationale: optionalString,
  projectId: optionalString,
  source: z.enum(["user", "codex", "tool"]).default("codex"),
  supersedes: z.array(z.string()).default([])
};

export function recordDecision(service: CcmService, input: z.infer<z.ZodObject<typeof recordDecisionSchema>>) {
  return { memory: service.recordDecision(input) };
}

export function registerRecordDecision(server: any, service: CcmService): void {
  server.tool(
    "record_decision",
    "Record a durable project decision as semantic memory.",
    recordDecisionSchema,
    async (input: z.infer<z.ZodObject<typeof recordDecisionSchema>>) => jsonContent(recordDecision(service, input))
  );
}
