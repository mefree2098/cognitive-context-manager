import type { CcmService } from "../core/consolidator.js";
import { AutoTailContextService } from "../core/auto-tail-context.js";
import type { HookResult, NormalizedHookPayload } from "../types/hooks.js";

export function handleUserPromptSubmit(service: CcmService, payload: NormalizedHookPayload): HookResult {
  const result = service.handleHook(payload);
  const prompt = payload.text?.trim();
  if (!prompt || prompt.includes("CCM_AUTO_TAIL_CONTEXT_START")) return result;

  const preview = new AutoTailContextService(service).preview({
    query: prompt,
    repoPath: payload.cwd,
    acceptedPreview: acceptedPreview(payload.rawPayload)
  });

  if (!preview.policyWouldAllowInjection || !preview.tailBlock) return result;

  return {
    ...result,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: preview.tailBlock,
      ccmAutoTail: {
        reason: preview.reason,
        tokenEstimate: preview.tokenEstimate,
        memoryIds: preview.memoryIds,
        openLoopIds: preview.openLoopIds,
        warnings: preview.warnings
      }
    }
  };
}

function acceptedPreview(payload: Record<string, unknown>): boolean {
  return (
    boolValue(payload.ccmAutoTailAcceptedPreview) ||
    boolValue(payload.ccm_auto_tail_accepted_preview) ||
    boolValue(process.env.CCM_AUTO_TAIL_ACCEPTED_PREVIEW)
  );
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}
