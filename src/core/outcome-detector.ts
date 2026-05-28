import type { EventsRepo } from "../storage/repositories/events-repo.js";
import type { SourceRef } from "../types/memory.js";

export type OutcomeKind = "build_passed" | "tests_passed" | "deployed" | "qa_verified" | "blocked" | "abandoned";

const OUTCOME_PATTERNS: Array<{ kind: OutcomeKind; regex: RegExp }> = [
  { kind: "build_passed", regex: /\b(?:build passed|build succeeded|clean build|xcodebuild succeeded|tsc .*passed)\b/i },
  { kind: "tests_passed", regex: /\b(?:tests? passed|test suite passed|vitest .*passed|pytest .*passed|npm test .*passed)\b/i },
  { kind: "deployed", regex: /\b(?:deployed|deployment succeeded|pushed to production|production deploy)\b/i },
  { kind: "qa_verified", regex: /\b(?:qa verified|qa passed|verified in production|production verified|smoke test(?:s)? passed|verified on device|verified on disk)\b/i },
  { kind: "blocked", regex: /\b(?:blocked|stuck|cannot proceed|waiting on|needs access|needs credentials|unresolved blocker)\b/i },
  { kind: "abandoned", regex: /\b(?:abandoned|cancelled|canceled|deferred|won't continue|stopped work on)\b/i }
];

export function detectOutcomeKinds(text: string): OutcomeKind[] {
  return OUTCOME_PATTERNS.filter((pattern) => pattern.regex.test(text)).map((pattern) => pattern.kind);
}

export function recordOutcomeEvents(input: {
  events: EventsRepo;
  projectId?: string;
  sessionId?: string;
  text: string;
  sourceRefs?: SourceRef[];
}): string[] {
  if (!input.sessionId) return [];
  const kinds = detectOutcomeKinds(input.text);
  const ids: string[] = [];
  for (const kind of kinds) {
    const event = input.events.create({
      sessionId: input.sessionId,
      projectId: input.projectId,
      eventType: "outcome",
      title: `Outcome: ${kind}`,
      summary: outcomeSummary(kind, input.text),
      entities: [],
      sourceRefs: input.sourceRefs ?? [],
      salience: kind === "blocked" ? 0.9 : 0.82,
      confidence: 0.78
    });
    ids.push(event.id);
  }
  return ids;
}

function outcomeSummary(kind: OutcomeKind, text: string): string {
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 260);
  return `${kind}: ${compact}`;
}
