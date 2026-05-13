import stripAnsi from "strip-ansi";
import type { EventBoundary, EventType } from "../types/event.js";
import type { HookEventName, NormalizedHookPayload } from "../types/hooks.js";
import { scoreSignals } from "./salience-scorer.js";
import { redactSecrets } from "./secret-redactor.js";
import { truncateToTokens } from "./tokenizer.js";

const CORRECTION = /\b(this is wrong|wrong|actually|instead|not that|stop doing|don't|do not)\b/i;
const PREFERENCE = /\b(from now on|always|never|prefer|please remember|remember that|do not|don't)\b/i;
const DECISION = /\b(decided|decision|we will|use .+ instead|go with|settled on)\b/i;
const OPEN_LOOP = /\b(todo|follow up|unresolved|open loop|later|next step|blocker|needs? to)\b/i;
const TOPIC_SHIFT = /\b(new task|different issue|switching|separate thing|now let's|instead work on)\b/i;
const TEST_COMMAND = /\b(test|vitest|jest|pytest|mocha|npm run check|npm run build|tsc|eslint|lint)\b/i;

function firstString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function collectChangedFiles(payload: Record<string, unknown>): string[] {
  const candidates = [payload.changedFiles, payload.changed_files, payload.files, payload.modifiedFiles];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is string => typeof item === "string");
  }
  const output = firstString(payload, ["output", "stdout", "stderr", "result"]) ?? "";
  const matches = [...output.matchAll(/\b(?:modified|created|deleted|changed):\s+([^\s]+)/gi)].map((match) => match[1]);
  return [...new Set(matches)];
}

function parseExitCode(payload: Record<string, unknown>): number | undefined {
  for (const key of ["exitCode", "exit_code", "status", "code"]) {
    const value = payload[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

function normalizeEventName(value: string): HookEventName {
  const allowed: HookEventName[] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop"
  ];
  return allowed.includes(value as HookEventName) ? (value as HookEventName) : "Stop";
}

export function normalizeHookPayload(eventName: string, payload: Record<string, unknown> = {}): NormalizedHookPayload {
  const text = firstString(payload, ["prompt", "userPrompt", "text", "message", "input"]);
  const command = firstString(payload, ["command", "cmd", "shell_command"]);
  const output = firstString(payload, ["output", "stdout", "stderr", "result"]);
  const cwd =
    firstString(payload, ["cwd", "workingDirectory", "working_directory"]) ||
    process.env.PWD ||
    process.cwd();

  return {
    eventName: normalizeEventName(eventName),
    timestamp: new Date().toISOString(),
    cwd,
    gitRoot: firstString(payload, ["gitRoot", "git_root"]),
    codexSessionId: firstString(payload, ["sessionId", "codexSessionId"]) || process.env.CODEX_SESSION_ID,
    rawPayload: payload,
    text,
    toolName: firstString(payload, ["tool", "toolName", "name"]),
    command,
    exitCode: parseExitCode(payload),
    output,
    changedFiles: collectChangedFiles(payload),
    approvalReason: firstString(payload, ["reason", "approvalReason", "justification"])
  };
}

export function summarizeHookPayload(payload: NormalizedHookPayload): string {
  const parts = [
    payload.text ? `Prompt: ${payload.text}` : undefined,
    payload.toolName ? `Tool: ${payload.toolName}` : undefined,
    payload.command ? `Command: ${payload.command}` : undefined,
    payload.exitCode !== undefined ? `Exit code: ${payload.exitCode}` : undefined,
    payload.output ? `Output: ${stripAnsi(payload.output)}` : undefined,
    payload.changedFiles.length ? `Changed files: ${payload.changedFiles.join(", ")}` : undefined
  ].filter(Boolean);

  const redacted = redactSecrets(parts.join("\n")).text;
  return truncateToTokens(redacted, 220);
}

export function detectEventBoundary(input: NormalizedHookPayload): EventBoundary {
  const text = [input.text, input.command, input.output, input.approvalReason].filter(Boolean).join("\n");
  const signals: string[] = [];

  if (input.eventName === "SessionStart") signals.push("session_start");
  if (input.eventName === "UserPromptSubmit") signals.push("user_prompt");
  if (input.eventName === "PreToolUse") signals.push("tool_use");
  if (input.eventName === "PostToolUse") signals.push("tool_result");
  if (input.eventName === "PermissionRequest") signals.push("permission_request");
  if (input.eventName === "Stop") signals.push("session_stop");
  if (CORRECTION.test(text)) signals.push("correction");
  if (PREFERENCE.test(text)) signals.push("preference");
  if (DECISION.test(text)) signals.push("decision");
  if (OPEN_LOOP.test(text)) signals.push("open_loop");
  if (TOPIC_SHIFT.test(text)) signals.push("topic_shift");
  if (input.exitCode !== undefined && input.exitCode !== 0) signals.push("failure");
  if (input.changedFiles.length) signals.push("artifact_change");
  if (input.command && TEST_COMMAND.test(input.command)) signals.push("test_result");

  const salience = scoreSignals(signals, text);
  const eventType = chooseEventType(signals);

  return {
    isBoundary: salience >= 0.35,
    eventType,
    signals,
    salience,
    confidence: input.eventName === "PostToolUse" && input.exitCode !== undefined ? 0.85 : 0.72,
    title: titleForEvent(eventType, input),
    summary: summarizeHookPayload(input)
  };
}

export function chooseEventType(signals: string[]): EventType {
  if (signals.includes("failure")) return "failure";
  if (signals.includes("test_result")) return "test_result";
  if (signals.includes("artifact_change")) return "artifact_change";
  if (signals.includes("decision")) return "decision";
  if (signals.includes("preference")) return "preference";
  if (signals.includes("topic_shift")) return "topic_shift";
  if (signals.includes("tool_result")) return "tool_result";
  if (signals.includes("tool_use")) return "tool_use";
  if (signals.includes("session_start")) return "session_start";
  if (signals.includes("session_stop")) return "session_stop";
  return "user_prompt";
}

function titleForEvent(eventType: EventType, input: NormalizedHookPayload): string {
  if (eventType === "test_result" && input.command) return `Test/build command: ${input.command}`;
  if (eventType === "artifact_change" && input.changedFiles.length) return `Artifact change: ${input.changedFiles[0]}`;
  if (eventType === "failure" && input.command) return `Failure: ${input.command}`;
  if (eventType === "decision") return "Decision captured";
  if (eventType === "preference") return "Preference captured";
  return eventType.replace(/_/g, " ");
}

export function extractEntities(text: string): string[] {
  const fileLike = [...text.matchAll(/\b[\w./-]+\.(?:ts|tsx|js|jsx|json|md|sql|py|go|rs|swift|kt|java|css|html)\b/g)].map(
    (match) => match[0]
  );
  const quoted = [...text.matchAll(/`([^`]{2,80})`/g)].map((match) => match[1]);
  return [...new Set([...fileLike, ...quoted])].slice(0, 20);
}

export function looksLikeOpenLoop(text: string): boolean {
  return OPEN_LOOP.test(text) || /\?\s*$/.test(text.trim());
}
