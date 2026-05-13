import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const getOpenLoopsSchema = {
  projectId: optionalString,
  includeClosed: z.boolean().default(false),
  limit: z.number().int().positive().max(50).default(20)
};

export function getOpenLoops(service: CcmService, input: z.infer<z.ZodObject<typeof getOpenLoopsSchema>>) {
  return { open_loops: service.openLoops.list(input.projectId, input.includeClosed, input.limit) };
}

export function registerGetOpenLoops(server: any, service: CcmService): void {
  server.tool(
    "get_open_loops",
    "Return unresolved tasks, blockers, questions, and TODOs.",
    getOpenLoopsSchema,
    async (input: z.infer<z.ZodObject<typeof getOpenLoopsSchema>>) => jsonContent(getOpenLoops(service, input))
  );
}
