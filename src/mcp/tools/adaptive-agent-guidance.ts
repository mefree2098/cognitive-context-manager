import { z } from "zod";
import { loadConfig } from "../../config/load-config.js";
import { AdaptiveAgentGuidanceService } from "../../core/adaptive-agents.js";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

const emptySchema = {};

export const previewAdaptiveAgentPatchSchema = {
  text: z.string().min(1)
};

export const proposeAdaptiveAgentPatchSchema = {
  text: optionalString,
  rule: optionalString,
  reason: optionalString,
  sourceEventIds: z.array(z.string()).default([]),
  requiresReview: z.boolean().default(true)
};

export const adaptivePatchIdSchema = {
  id: optionalString,
  allowProtectedSectionChange: z.boolean().default(false)
};

export const rejectAdaptivePatchSchema = {
  id: optionalString,
  reason: z.string().default("Rejected by user.")
};

export const rollbackAdaptiveGuidanceSchema = {
  to: z.string().default("last")
};

export const explainAdaptiveRuleSchema = {
  query: z.string().min(1)
};

export function registerAdaptiveAgentGuidanceTools(server: any, service: CcmService): void {
  const adaptive = () => new AdaptiveAgentGuidanceService(service.db, loadConfig(process.cwd()));
  server.tool("get_adaptive_agent_guidance", "Return compact active CCM adaptive guidance.", emptySchema, async () =>
    jsonContent(adaptive().preview())
  );
  server.tool(
    "preview_adaptive_agent_patch",
    "Preview an adaptive guidance patch without writing.",
    previewAdaptiveAgentPatchSchema,
    async (input: z.infer<z.ZodObject<typeof previewAdaptiveAgentPatchSchema>>) => jsonContent({ patch: adaptive().previewPatch(input.text) })
  );
  server.tool(
    "propose_adaptive_agent_patch",
    "Create a pending adaptive guidance patch.",
    proposeAdaptiveAgentPatchSchema,
    async (input: z.infer<z.ZodObject<typeof proposeAdaptiveAgentPatchSchema>>) => jsonContent({ patch: adaptive().proposePatch(input) })
  );
  server.tool(
    "apply_adaptive_agent_patch",
    "Apply a pending adaptive guidance patch to CCM_AGENTS.md.",
    adaptivePatchIdSchema,
    async (input: z.infer<z.ZodObject<typeof adaptivePatchIdSchema>>) =>
      jsonContent({ patch: adaptive().applyPatch(input.id, { allowProtectedSectionChange: input.allowProtectedSectionChange, appliedBy: "mcp" }) })
  );
  server.tool(
    "reject_adaptive_agent_patch",
    "Reject a pending adaptive guidance patch.",
    rejectAdaptivePatchSchema,
    async (input: z.infer<z.ZodObject<typeof rejectAdaptivePatchSchema>>) => jsonContent({ patch: adaptive().rejectPatch(input.id, input.reason) })
  );
  server.tool(
    "rollback_adaptive_agent_guidance",
    "Restore a prior CCM_AGENTS.md version.",
    rollbackAdaptiveGuidanceSchema,
    async (input: z.infer<z.ZodObject<typeof rollbackAdaptiveGuidanceSchema>>) => jsonContent({ version: adaptive().rollback(input.to) })
  );
  server.tool(
    "explain_adaptive_agent_rule",
    "Explain why an adaptive guidance rule exists.",
    explainAdaptiveRuleSchema,
    async (input: z.infer<z.ZodObject<typeof explainAdaptiveRuleSchema>>) => jsonContent(adaptive().explainRule(input.query))
  );
}
