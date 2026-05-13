import type { CcmService } from "../core/consolidator.js";
import type { HookResult, NormalizedHookPayload } from "../types/hooks.js";

export function handlePostToolUse(service: CcmService, payload: NormalizedHookPayload): HookResult {
  return service.handleHook(payload);
}
