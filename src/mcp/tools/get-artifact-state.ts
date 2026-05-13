import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const getArtifactStateSchema = {
  projectId: optionalString,
  limit: z.number().int().positive().max(100).default(30)
};

export function getArtifactState(service: CcmService, input: z.infer<z.ZodObject<typeof getArtifactStateSchema>>) {
  return { artifacts: service.artifacts.list(input.projectId, input.limit) };
}

export function registerGetArtifactState(server: any, service: CcmService): void {
  server.tool(
    "get_artifact_state",
    "Return tracked artifact summaries and last-known file/test state.",
    getArtifactStateSchema,
    async (input: z.infer<z.ZodObject<typeof getArtifactStateSchema>>) => jsonContent(getArtifactState(service, input))
  );
}
