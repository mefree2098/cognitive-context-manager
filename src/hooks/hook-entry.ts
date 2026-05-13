#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { openDb } from "../storage/db.js";
import { CcmService } from "../core/consolidator.js";
import { normalizeHookPayload } from "../core/event-segmenter.js";
import { log } from "../core/logger.js";
import type { HookEventName } from "../types/hooks.js";
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
  const payload = normalizeHookPayload(eventName, rawPayload ?? {});
  const context = openDb(payload.cwd);
  try {
    const service = new CcmService({ db: context.db, repoPath: payload.cwd });
    switch (payload.eventName) {
      case "SessionStart":
        return handleSessionStart(service, payload);
      case "UserPromptSubmit":
        return handleUserPromptSubmit(service, payload);
      case "PreToolUse":
        return handlePreToolUse(service, payload);
      case "PostToolUse":
        return handlePostToolUse(service, payload);
      case "PermissionRequest":
        return handlePermissionRequest(service, payload);
      case "Stop":
        return handleStop(service, payload);
      default:
        return service.handleHook(payload);
    }
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
    if (result.warnings.length) {
      process.stdout.write(`${JSON.stringify({ ok: true, warnings: result.warnings })}\n`);
    }
  } catch (error) {
    log("error", "Hook failed gracefully", { eventName, error: error instanceof Error ? error.message : String(error) });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log("error", "Hook top-level failure", { error: error instanceof Error ? error.message : String(error) });
    process.exit(0);
  });
}
