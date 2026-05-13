import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const compactSessionSchema = {
  repoPath: optionalString,
  projectId: optionalString,
  sessionId: optionalString,
  maxTokens: z.number().int().positive().max(12000).default(2200)
};

export function compactSession(service: CcmService, input: z.infer<z.ZodObject<typeof compactSessionSchema>>) {
  return service.compactSession(input);
}

export function registerCompactSession(server: any, service: CcmService): void {
  server.tool(
    "compact_session",
    "Create a concise handoff summary for the current session.",
    compactSessionSchema,
    async (input: z.infer<z.ZodObject<typeof compactSessionSchema>>) => jsonContent(compactSession(service, input))
  );
}
