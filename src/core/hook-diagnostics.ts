import type Database from "better-sqlite3";
import { hookAttemptLogPath, readHookAttemptLog, type HookAttemptLogEntry } from "./hook-attempt-log.js";

export type PassiveHookStatus = "recent" | "stale" | "not_seen";
export type HookAttemptLogStatus = "not_seen" | "self_test_only" | "real_attempts_seen";
export type PassiveHookProof = "not_proven" | "self_test_only" | "host_launch_seen" | "host_launch_and_trace_proven";

export const RECENT_PASSIVE_HOOK_HOURS = 48;
export const REAL_PASSIVE_HOOK_WHERE =
  "trace_type = 'hook' AND COALESCE(json_extract(payload_json, '$.selfTest'), 0) = 0 AND COALESCE(session_id, '') NOT IN (SELECT id FROM sessions WHERE codex_session_id LIKE 'ccm-doctor-self-test-%')";

export interface HookTraceSnapshot {
  count: number;
  latestAt?: string;
}

export interface HookWatchSnapshot {
  generatedAt: string;
  startedAt: string;
  attemptLogPath: string;
  selfTestAttempts: number;
  realHookAttempts: number;
  latestRealAttemptAt?: string;
  latestRealAttemptStage?: string;
  realHookTraces: number;
  latestRealHookTraceAt?: string;
  passiveHookProof: PassiveHookProof;
}

export function passiveHookStatus(latestPassiveHookAt?: string, passiveHookAgeHours?: number): PassiveHookStatus {
  if (!latestPassiveHookAt) return "not_seen";
  return typeof passiveHookAgeHours === "number" && passiveHookAgeHours <= RECENT_PASSIVE_HOOK_HOURS ? "recent" : "stale";
}

export function passiveHookProof(input: {
  passiveHookStatus: PassiveHookStatus;
  passiveHookEvents: number;
  realHookAttemptLogEntries: number;
  hookAttemptLogStatus: HookAttemptLogStatus;
}): PassiveHookProof {
  if (input.passiveHookStatus === "recent" && input.passiveHookEvents > 0) return "host_launch_and_trace_proven";
  if (input.realHookAttemptLogEntries > 0) return "host_launch_seen";
  if (input.hookAttemptLogStatus === "self_test_only") return "self_test_only";
  return "not_proven";
}

export function realPassiveHookTraceSnapshot(db: Database.Database, sinceIso?: string): HookTraceSnapshot {
  const sinceClause = sinceIso ? " AND created_at >= @sinceIso" : "";
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, MAX(created_at) AS latestAt
       FROM trace_entries
       WHERE ${REAL_PASSIVE_HOOK_WHERE}${sinceClause}`
    )
    .get(sinceIso ? { sinceIso } : {}) as { count?: number; latestAt?: string } | undefined;
  return {
    count: Number(row?.count ?? 0),
    latestAt: typeof row?.latestAt === "string" ? row.latestAt : undefined
  };
}

export function hookWatchSnapshot(db: Database.Database, home: string, startedAt: string): HookWatchSnapshot {
  const attempts = readHookAttemptLog(home, startedAt);
  const realAttempts = attempts.filter((entry) => !entry.selfTest);
  const latestRealAttempt = realAttempts.at(-1);
  const traceSnapshot = realPassiveHookTraceSnapshot(db, startedAt);
  const attemptStatus: HookAttemptLogStatus = realAttempts.length > 0 ? "real_attempts_seen" : attempts.length > 0 ? "self_test_only" : "not_seen";
  const proof = passiveHookProof({
    passiveHookStatus: traceSnapshot.count > 0 ? "recent" : "not_seen",
    passiveHookEvents: traceSnapshot.count,
    realHookAttemptLogEntries: realAttempts.length,
    hookAttemptLogStatus: attemptStatus
  });
  return {
    generatedAt: new Date().toISOString(),
    startedAt,
    attemptLogPath: hookAttemptLogPath(home),
    selfTestAttempts: attempts.length - realAttempts.length,
    realHookAttempts: realAttempts.length,
    latestRealAttemptAt: latestRealAttempt?.timestamp,
    latestRealAttemptStage: latestRealAttempt?.stage,
    realHookTraces: traceSnapshot.count,
    latestRealHookTraceAt: traceSnapshot.latestAt,
    passiveHookProof: proof
  };
}

export function describePassiveHookProof(proof: PassiveHookProof): string {
  switch (proof) {
    case "host_launch_and_trace_proven":
      return "Host-fired hook launch and passive hook trace are both proven.";
    case "host_launch_seen":
      return "Host-fired hook launch was seen, but no matching passive hook trace was recorded yet.";
    case "self_test_only":
      return "Only CCM self-tests have launched the hook entrypoint so far.";
    case "not_proven":
      return "No current host-fired passive hook proof has been observed.";
  }
}

export function latestRealAttempt(entries: HookAttemptLogEntry[]): HookAttemptLogEntry | undefined {
  return entries.filter((entry) => !entry.selfTest).at(-1);
}
