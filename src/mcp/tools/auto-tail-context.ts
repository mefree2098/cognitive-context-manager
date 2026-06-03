import { z } from "zod";
import { AutoTailContextService } from "../../core/auto-tail-context.js";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

const previewAutoTailContextSchema = {
  query: z.string().min(1),
  repoPath: optionalString,
  projectName: optionalString,
  maxTokens: z.number().int().positive().max(12000).optional(),
  forcePreview: z.boolean().default(false),
  acceptedPreview: z.boolean().default(false)
};

export function previewAutoTailContext(
  service: CcmService,
  input: z.infer<z.ZodObject<typeof previewAutoTailContextSchema>>
) {
  return new AutoTailContextService(service).preview(input);
}

export function registerAutoTailContext(server: any, service: CcmService): void {
  server.tool(
    "preview_auto_tail_context",
    "Preview CCM's policy-gated latest-user-tail context block. This never performs runtime injection.",
    previewAutoTailContextSchema,
    async (input: z.infer<z.ZodObject<typeof previewAutoTailContextSchema>>) =>
      jsonContent(previewAutoTailContext(service, input))
  );
}
