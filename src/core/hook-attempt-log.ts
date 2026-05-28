import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type HookAttemptStage = "received" | "recorded" | "failed";

export interface HookAttemptLogEntry {
  timestamp: string;
  stage: HookAttemptStage;
  eventName: string;
  cwd?: string;
  sessionId?: string;
  selfTest: boolean;
  payloadKeys: string[];
  pluginRoot?: string;
  pid?: number;
  error?: string;
}

export interface HookAttemptStats {
  path: string;
  entries: number;
  realEntries: number;
  selfTestEntries: number;
  latestAt?: string;
  latestStage?: HookAttemptStage;
  latestRealAt?: string;
  latestRealStage?: HookAttemptStage;
  status: "not_seen" | "self_test_only" | "real_attempts_seen";
}

export function defaultCcmHome(): string {
  return process.env.CCM_HOME || join(homedir(), ".codex", "cognitive-context-manager");
}

export function hookAttemptLogPath(home = defaultCcmHome()): string {
  return join(home, "logs", "hook-attempts.jsonl");
}

export function recordHookAttempt(input: {
  stage: HookAttemptStage;
  eventName: string;
  rawPayload: Record<string, unknown>;
  pluginRoot?: string;
  home?: string;
  error?: unknown;
}): void {
  try {
    const logsDir = join(input.home ?? defaultCcmHome(), "logs");
    mkdirSync(logsDir, { recursive: true });
    const entry: HookAttemptLogEntry = {
      timestamp: new Date().toISOString(),
      stage: input.stage,
      eventName: input.eventName,
      cwd: stringPayloadValue(input.rawPayload, ["cwd", "workingDirectory", "working_directory"]) ?? process.env.PWD ?? process.cwd(),
      sessionId: stringPayloadValue(input.rawPayload, ["sessionId", "codexSessionId"]) ?? process.env.CODEX_SESSION_ID,
      selfTest: input.rawPayload.ccmSelfTest === true,
      payloadKeys: Object.keys(input.rawPayload).sort(),
      pluginRoot: input.pluginRoot,
      pid: process.pid,
      error: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : undefined
    };
    appendFileSync(join(logsDir, "hook-attempts.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Hooks must never fail the host process because diagnostics could not be written.
  }
}

export function readHookAttemptLog(home = defaultCcmHome(), windowStart?: string | null): HookAttemptLogEntry[] {
  const path = hookAttemptLogPath(home);
  if (!existsSync(path)) return [];
  const cutoff = windowStart ? new Date(windowStart).getTime() : undefined;
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => parseLine(line))
    .filter((entry): entry is HookAttemptLogEntry => Boolean(entry))
    .filter((entry) => {
      if (cutoff === undefined) return true;
      const timestamp = new Date(entry.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
}

export function hookAttemptStats(home = defaultCcmHome(), windowStart?: string | null): HookAttemptStats {
  const entries = readHookAttemptLog(home, windowStart);
  const latest = entries.at(-1);
  const realEntries = entries.filter((entry) => !entry.selfTest);
  const latestReal = realEntries.at(-1);
  return {
    path: hookAttemptLogPath(home),
    entries: entries.length,
    realEntries: realEntries.length,
    selfTestEntries: entries.length - realEntries.length,
    latestAt: latest?.timestamp,
    latestStage: latest?.stage,
    latestRealAt: latestReal?.timestamp,
    latestRealStage: latestReal?.stage,
    status: realEntries.length > 0 ? "real_attempts_seen" : entries.length > 0 ? "self_test_only" : "not_seen"
  };
}

function stringPayloadValue(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function parseLine(line: string): HookAttemptLogEntry | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.timestamp !== "string" || typeof record.eventName !== "string") return undefined;
    return {
      timestamp: record.timestamp,
      stage: isStage(record.stage) ? record.stage : "received",
      eventName: record.eventName,
      cwd: typeof record.cwd === "string" ? record.cwd : undefined,
      sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
      selfTest: record.selfTest === true,
      payloadKeys: Array.isArray(record.payloadKeys) ? record.payloadKeys.filter((item): item is string => typeof item === "string") : [],
      pluginRoot: typeof record.pluginRoot === "string" ? record.pluginRoot : undefined,
      pid: typeof record.pid === "number" ? record.pid : undefined,
      error: typeof record.error === "string" ? record.error : undefined
    };
  } catch {
    return undefined;
  }
}

function isStage(value: unknown): value is HookAttemptStage {
  return value === "received" || value === "recorded" || value === "failed";
}
