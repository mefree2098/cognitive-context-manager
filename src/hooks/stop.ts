import type { CcmService } from "../core/consolidator.js";
import type { HookResult, NormalizedHookPayload } from "../types/hooks.js";

export function handleStop(service: CcmService, payload: NormalizedHookPayload): HookResult {
  return service.handleHook(payload);
}
