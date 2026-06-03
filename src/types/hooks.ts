export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PermissionRequest"
  | "Stop";

export interface NormalizedHookPayload {
  eventName: HookEventName;
  timestamp: string;
  cwd: string;
  gitRoot?: string;
  codexSessionId?: string;
  rawPayload: Record<string, unknown>;
  text?: string;
  toolName?: string;
  command?: string;
  exitCode?: number;
  output?: string;
  changedFiles: string[];
  approvalReason?: string;
}

export interface HookResult {
  ok: boolean;
  message?: string;
  warnings: string[];
  ids: string[];
  hookSpecificOutput?: Record<string, unknown>;
}
