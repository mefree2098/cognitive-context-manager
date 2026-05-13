import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const explainRetrievalSchema = {
  query: z.string().min(1),
  project_id: optionalString,
  max_tokens: z.number().int().positive().max(12000).default(1200)
};

export function registerExplainRetrieval(server: any, service: CcmService): void {
  server.tool("explain_retrieval", "Explain why memories were selected or excluded.", explainRetrievalSchema, async (input: z.infer<z.ZodObject<typeof explainRetrievalSchema>>) =>
    jsonContent(service.explainRetrieval({ query: input.query, projectId: input.project_id, maxTokens: input.max_tokens }))
  );
}
