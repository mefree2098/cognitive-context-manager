import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const getWorkingContextSchema = {
  task: z.string().min(1),
  repoPath: optionalString,
  projectName: optionalString,
  maxTokens: z.number().int().positive().max(12000).default(3000),
  includeArtifacts: z.boolean().default(true),
  includeOpenLoops: z.boolean().default(true),
  includeProcedural: z.boolean().default(true)
};

export function getWorkingContext(service: CcmService, input: z.infer<z.ZodObject<typeof getWorkingContextSchema>>) {
  return service.getWorkingContext(input);
}

export function registerGetWorkingContext(server: any, service: CcmService): void {
  server.tool(
    "get_working_context",
    "Return a compact context brief for a non-trivial Codex task.",
    getWorkingContextSchema,
    async (input: z.infer<z.ZodObject<typeof getWorkingContextSchema>>) => jsonContent(getWorkingContext(service, input))
  );
}
