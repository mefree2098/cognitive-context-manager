import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const previewContextBriefSchema = {
  query: z.string().min(1),
  repoPath: optionalString,
  maxTokens: z.number().int().positive().max(12000).default(1200)
};

export function registerPreviewContextBrief(server: any, service: CcmService): void {
  server.tool("preview_context_brief", "Preview a CCM context brief without changing user-facing output.", previewContextBriefSchema, async (input: z.infer<z.ZodObject<typeof previewContextBriefSchema>>) =>
    jsonContent(service.getWorkingContext({ task: input.query, repoPath: input.repoPath, maxTokens: input.maxTokens }))
  );
}
