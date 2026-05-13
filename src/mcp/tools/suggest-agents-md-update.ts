import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const suggestAgentsMdUpdateSchema = {
  project_id: optionalString,
  reason: z.string().min(1),
  candidate_instruction: z.string().min(1),
  evidence_memory_ids: z.array(z.string()).default([])
};

export function registerSuggestAgentsMdUpdate(server: any, service: CcmService): void {
  server.tool("suggest_agents_md_update", "Suggest, but never auto-apply, an AGENTS.md instruction update.", suggestAgentsMdUpdateSchema, async (input: z.infer<z.ZodObject<typeof suggestAgentsMdUpdateSchema>>) =>
    jsonContent(service.suggestAgentsMdUpdate({
      projectId: input.project_id,
      repoPath: process.cwd(),
      reason: input.reason,
      candidateInstruction: input.candidate_instruction,
      evidenceMemoryIds: input.evidence_memory_ids
    }))
  );
}
