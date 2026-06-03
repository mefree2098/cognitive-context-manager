#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { openDb } from "../storage/db.js";
import { CcmService } from "../core/consolidator.js";
import { normalizeHookPayload } from "../core/event-segmenter.js";
import { recordHookAttempt } from "../core/hook-attempt-log.js";
import { log } from "../core/logger.js";
import { isMainModule } from "../runtime/is-main.js";
import type { HookEventName, HookResult } from "../types/hooks.js";
import { handleSessionStart } from "./session-start.js";
import { handleUserPromptSubmit } from "./user-prompt-submit.js";
import { handlePreToolUse } from "./pre-tool-use.js";
import { handlePostToolUse } from "./post-tool-use.js";
import { handlePermissionRequest } from "./permission-request.js";
import { handleStop } from "./stop.js";

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function parsePayload(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { raw };
  } catch {
    return { raw };
  }
}

export async function runHook(eventName: string, rawPayload?: Record<string, unknown>) {
  recordHookAttempt({ stage: "received", eventName, rawPayload: rawPayload ?? {}, pluginRoot });
  const payload = normalizeHookPayload(eventName, rawPayload ?? {});
  const context = openDb(payload.cwd);
  try {
    const service = new CcmService({ db: context.db, repoPath: payload.cwd });
    let result: HookResult;
    switch (payload.eventName) {
      case "SessionStart":
        result = handleSessionStart(service, payload);
        break;
      case "UserPromptSubmit":
        result = handleUserPromptSubmit(service, payload);
        break;
      case "PreToolUse":
        result = handlePreToolUse(service, payload);
        break;
      case "PostToolUse":
        result = handlePostToolUse(service, payload);
        break;
      case "PermissionRequest":
        result = handlePermissionRequest(service, payload);
        break;
      case "Stop":
        result = handleStop(service, payload);
        break;
      default:
        result = service.handleHook(payload);
    }
    recordHookAttempt({ stage: "recorded", eventName, rawPayload: rawPayload ?? {}, pluginRoot });
    return result;
  } finally {
    context.db.close();
  }
}

async function main(): Promise<void> {
  const eventName = (process.argv[2] ?? "Stop") as HookEventName;
  const stdin = await readStdin();
  const payload = parsePayload(stdin);
  try {
    const result = await runHook(eventName, payload);
    const response: Record<string, unknown> = {};
    if (result.warnings.length) response.warnings = result.warnings;
    if (result.hookSpecificOutput) response.hookSpecificOutput = result.hookSpecificOutput;
    if (Object.keys(response).length) {
      process.stdout.write(`${JSON.stringify({ ok: true, ...response })}\n`);
    }
  } catch (error) {
    recordHookAttempt({ stage: "failed", eventName, rawPayload: payload, pluginRoot, error });
    log("error", "Hook failed gracefully", { eventName, error: error instanceof Error ? error.message : String(error) });
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    log("error", "Hook top-level failure", { error: error instanceof Error ? error.message : String(error) });
    process.exit(0);
  });
}
