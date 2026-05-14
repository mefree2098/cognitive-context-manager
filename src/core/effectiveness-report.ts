import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { CcmConfig } from "../types/config.js";
import { estimateTokens } from "./tokenizer.js";

type Format = "json" | "markdown";

export interface EffectivenessReportOptions {
  since?: string;
  projectId?: string;
  projectName?: string;
  format?: Format;
  sampleLimit?: number;
}

export interface EffectivenessReport {
  generatedAt: string;
  since: string;
  windowStart: string | null;
  projectFilter?: {
    id?: string;
    name?: string;
  };
  summary: {
    projectsObserved: number;
    sessionsObserved: number;
    eventsCaptured: number;
    memoriesStored: number;
    activeMemories: number;
    contextBriefsGenerated: number;
    retrievalTraces: number;
    hookEvents: number;
    decisionsRecorded: number;
    preferencesRecorded: number;
    openLoopsCreated: number;
    openLoopsResolved: number;
    artifactsTracked: number;
  };
  effectiveness: {
    estimatedRawTokensAvoided: number;
    estimatedInjectedMemoryTokens: number;
    netEstimatedTokenSavings: number;
    staleOrSupersededMemoriesExcluded: number;
    openLoopTasksPreserved: number;
    repeatUserRemindersDetected: number;
    contextActivationRate: number;
  };
  resilience: {
    failureSignals: number;
    recoverySignals: number;
    resumeSignals: number;
    checkpointSignals: number;
    filesystemVerificationSignals: number;
    lastCheckpoint?: string;
    longRunningTaskSignals: number;
  };
  reliability: {
    hookFailuresLogged: number;
    mcpFailuresLogged: number;
    suspectedSecrets: number;
  };
  projects: Array<{
    id: string;
    name: string;
    rootPath?: string;
    sessions: number;
    events: number;
    memories: number;
    contextBriefs: number;
    checkpointSignals: number;
    resumeSignals: number;
    failureSignals: number;
    recoverySignals: number;
    lastSeenAt: string;
    lastCheckpoint?: string;
  }>;
  evidence: {
    checkpointSamples: string[];
    recoverySamples: string[];
    failureSamples: string[];
  };
  publishReadiness: {
    score: number;
    verdict: string;
    strengths: string[];
    gaps: string[];
  };
}

interface TextRow {
  project_id?: string;
  project_name?: string;
  root_path?: string;
  session_id?: string;
  text: string;
  created_at: string;
}

interface ProjectAggregateRow {
  id: string;
  name: string;
  root_path?: string;
  last_seen_at: string;
}

const CHECKPOINT_REGEX = /\b(?:page[_ -]?\d{1,4}\.(?:png|jpg|jpeg)|page[_ -]?\d{1,4}|title_page\.(?:png|jpg|jpeg)|contact_sheet[^ \n]*|checkpoint|last confirmed|confirmed on disk|disk confirms|filesystem checkpoint)\b/gi;
const RESUME_REGEX = /\b(?:resume|resuming|resumed|continue from|pick(?:ed)? up|restart(?:ed)? from|recover(?:ed|y|ing)?|handoff|session handoff)\b/i;
const RECOVERY_REGEX = /\b(?:recovered|resumed|continu(?:e|ed|ing)|verified on disk|disk confirms|last confirmed|checkpoint|handoff)\b/i;
const FAILURE_REGEX = /\b(?:fail(?:ed|ure)?|error|crash(?:ed)?|die(?:d|s)?|chok(?:e|ed|es|ing)|timeout|timed out|interrupted|stuck|loop(?:ing)?|reconnect|disconnect|blocked)\b/i;
const LONG_RUNNING_REGEX = /\b(?:long[- ]running|full manga|volume|batch|pages? \d{1,4}|\d{1,4}[- ]page|production run|checkpoint-heavy)\b/i;
const FILESYSTEM_VERIFY_REGEX = /\b(?:disk confirms|confirmed on disk|verified on disk|filesystem|finder verification|ls confirms|reading image_source_map|source_map)\b/i;
const SECRET_REGEX = /\b(?:redacted:|REDACTED_|api key|token|secret|password|private key)\b/i;

export class EffectivenessReportService {
  constructor(
    private readonly db: Database.Database,
    private readonly config: CcmConfig
  ) {}

  report(options: EffectivenessReportOptions = {}): EffectivenessReport {
    const windowStart = parseSince(options.since ?? "7d");
    const projectId = options.projectId ?? this.resolveProjectId(options.projectName);
    const sampleLimit = options.sampleLimit ?? 5;
    const filter = buildFilter(windowStart, projectId, projectId ? undefined : options.projectName);
    const textRows = this.textRows(filter);
    const summary = this.summary(filter);
    const resilience = this.resilience(textRows);
    const dividend = this.filteredDividend(filter);
    const projects = this.projectAggregates(filter, textRows);
    const reliability = {
      hookFailuresLogged: this.countLogMatches(/Hook .*failure|Hook failed/i),
      mcpFailuresLogged: this.countLogMatches(/MCP server failed/i),
      suspectedSecrets: textRows.filter((row) => SECRET_REGEX.test(row.text)).length
    };
    const effectiveness = {
      estimatedRawTokensAvoided: dividend.rawTranscriptTokensAvoided + dividend.rawLogTokensAvoided,
      estimatedInjectedMemoryTokens: dividend.injectedMemoryTokens,
      netEstimatedTokenSavings: dividend.netEstimatedTokenSavings,
      staleOrSupersededMemoriesExcluded: summary.memoriesStored - summary.activeMemories,
      openLoopTasksPreserved: dividend.openLoopTasksPreserved,
      repeatUserRemindersDetected: dividend.repeatUserRemindersDetected,
      contextActivationRate: summary.sessionsObserved ? round(summary.contextBriefsGenerated / summary.sessionsObserved, 2) : 0
    };
    const evidence = {
      checkpointSamples: samples(textRows, CHECKPOINT_REGEX, sampleLimit),
      recoverySamples: samples(textRows, RECOVERY_REGEX, sampleLimit),
      failureSamples: samples(textRows, FAILURE_REGEX, sampleLimit)
    };
    return {
      generatedAt: new Date().toISOString(),
      since: options.since ?? "7d",
      windowStart,
      projectFilter: projectId || options.projectName ? { id: projectId, name: options.projectName } : undefined,
      summary,
      effectiveness,
      resilience,
      reliability,
      projects,
      evidence,
      publishReadiness: publishReadiness(summary, effectiveness, resilience, reliability)
    };
  }

  renderMarkdown(report: EffectivenessReport): string {
    const lines = [
      "# Cognitive Context Manager Effectiveness Report",
      "",
      `Generated: ${report.generatedAt}`,
      `Window: ${report.since}${report.windowStart ? ` (since ${report.windowStart})` : ""}`,
      report.projectFilter?.name || report.projectFilter?.id
        ? `Project filter: ${report.projectFilter.name ?? ""}${report.projectFilter.id ? ` (${report.projectFilter.id})` : ""}`.trim()
        : "Project filter: all projects",
      "",
      "## Summary",
      "",
      `- Projects observed: ${report.summary.projectsObserved}`,
      `- Sessions observed: ${report.summary.sessionsObserved}`,
      `- Events captured: ${report.summary.eventsCaptured}`,
      `- Memories stored: ${report.summary.memoriesStored} (${report.summary.activeMemories} active)`,
      `- Context briefs generated: ${report.summary.contextBriefsGenerated}`,
      `- Decisions recorded: ${report.summary.decisionsRecorded}`,
      `- Open loops: ${report.summary.openLoopsCreated} created, ${report.summary.openLoopsResolved} resolved`,
      "",
      "## Effectiveness",
      "",
      `- Estimated raw tokens avoided: ${report.effectiveness.estimatedRawTokensAvoided}`,
      `- Injected memory tokens: ${report.effectiveness.estimatedInjectedMemoryTokens}`,
      `- Net estimated token savings: ${report.effectiveness.netEstimatedTokenSavings}`,
      `- Stale/superseded memories excluded: ${report.effectiveness.staleOrSupersededMemoriesExcluded}`,
      `- Context activation rate: ${report.effectiveness.contextActivationRate} briefs/session`,
      "",
      "## Long-Running Task Resilience",
      "",
      `- Failure signals: ${report.resilience.failureSignals}`,
      `- Recovery signals: ${report.resilience.recoverySignals}`,
      `- Resume signals: ${report.resilience.resumeSignals}`,
      `- Checkpoint signals: ${report.resilience.checkpointSignals}`,
      `- Filesystem verification signals: ${report.resilience.filesystemVerificationSignals}`,
      `- Last checkpoint: ${report.resilience.lastCheckpoint ?? "none detected"}`,
      "",
      "## Reliability",
      "",
      `- Hook failures logged: ${report.reliability.hookFailuresLogged}`,
      `- MCP failures logged: ${report.reliability.mcpFailuresLogged}`,
      `- Secret/redaction indicators in stored text: ${report.reliability.suspectedSecrets}`,
      "",
      "## Publish Readiness",
      "",
      `Score: ${report.publishReadiness.score}/100`,
      "",
      report.publishReadiness.verdict,
      "",
      "Strengths:",
      ...bulletList(report.publishReadiness.strengths),
      "",
      "Gaps:",
      ...bulletList(report.publishReadiness.gaps),
      "",
      "## Top Projects",
      "",
      ...projectLines(report.projects),
      "",
      "## Evidence Samples",
      "",
      "Checkpoint samples:",
      ...bulletList(report.evidence.checkpointSamples),
      "",
      "Recovery samples:",
      ...bulletList(report.evidence.recoverySamples),
      "",
      "Failure samples:",
      ...bulletList(report.evidence.failureSamples)
    ];
    return `${lines.join("\n")}\n`;
  }

  private resolveProjectId(projectName?: string): string | undefined {
    if (!projectName) return undefined;
    const row = this.db.prepare("SELECT id FROM projects WHERE name = ? OR root_path LIKE ? ORDER BY last_seen_at DESC LIMIT 1").get(projectName, `%${projectName}%`) as { id: string } | undefined;
    return row?.id;
  }

  private summary(filter: QueryFilter) {
    const sessionsObserved = scalar(this.db, `SELECT COUNT(*) FROM sessions ${filter.sessionWhere}`, filter.params);
    const eventsCaptured = scalar(this.db, `SELECT COUNT(*) FROM events ${filter.eventWhere}`, filter.params);
    const memoriesStored = scalar(this.db, `SELECT COUNT(*) FROM memories ${filter.memoryWhere}`, filter.params);
    const activeMemories = scalar(this.db, `SELECT COUNT(*) FROM memories ${filter.memoryWhereWith("stale_status = 'active'")}`, filter.params);
    const contextBriefsGenerated = scalar(this.db, `SELECT COUNT(*) FROM metrics ${filter.metricWhereWith("metric_name = 'context_brief_generation_latency'")}`, filter.params);
    const retrievalTraces = scalar(this.db, `SELECT COUNT(*) FROM trace_entries ${filter.traceWhereWith("trace_type = 'retrieval'")}`, filter.params);
    const hookEvents = scalar(this.db, `SELECT COUNT(*) FROM trace_entries ${filter.traceWhereWith("trace_type = 'hook'")}`, filter.params);
    const decisionsRecorded = scalar(this.db, `SELECT COUNT(*) FROM memories ${filter.memoryWhereWith("event_type = 'decision'")}`, filter.params);
    const preferencesRecorded = scalar(this.db, `SELECT COUNT(*) FROM memories ${filter.memoryWhereWith("event_type = 'preference'")}`, filter.params);
    const openLoopsCreated = scalar(this.db, `SELECT COUNT(*) FROM open_loops ${filter.openLoopWhere}`, filter.params);
    const openLoopsResolved = scalar(this.db, `SELECT COUNT(*) FROM open_loops ${filter.openLoopWhereWith("status <> 'open'")}`, filter.params);
    const artifactsTracked = scalar(this.db, `SELECT COUNT(*) FROM artifacts ${filter.artifactWhere}`, filter.params);
    const projectsObserved = scalar(this.db, `SELECT COUNT(DISTINCT project_id) FROM sessions ${filter.sessionWhere}`, filter.params);
    return {
      projectsObserved,
      sessionsObserved,
      eventsCaptured,
      memoriesStored,
      activeMemories,
      contextBriefsGenerated,
      retrievalTraces,
      hookEvents,
      decisionsRecorded,
      preferencesRecorded,
      openLoopsCreated,
      openLoopsResolved,
      artifactsTracked
    };
  }

  private textRows(filter: QueryFilter): TextRow[] {
    const eventRows = this.db
      .prepare(
        `SELECT e.project_id, p.name AS project_name, p.root_path, e.session_id, (COALESCE(e.title, '') || ' ' || e.summary) AS text, e.created_at
         FROM events e LEFT JOIN projects p ON p.id = e.project_id ${filter.eventJoinWhere}`
      )
      .all(filter.params) as TextRow[];
    const memoryRows = this.db
      .prepare(
        `SELECT m.project_id, p.name AS project_name, p.root_path, m.session_id, (COALESCE(m.summary, '') || ' ' || m.content) AS text, m.created_at
         FROM memories m LEFT JOIN projects p ON p.id = m.project_id ${filter.memoryJoinWhere}`
      )
      .all(filter.params) as TextRow[];
    return [...eventRows, ...memoryRows].sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private filteredDividend(filter: QueryFilter) {
    const memories = this.db
      .prepare(`SELECT content, summary, stale_status, memory_type FROM memories ${filter.memoryWhere}`)
      .all(filter.params) as Array<{ content?: string; summary?: string; stale_status?: string; memory_type?: string }>;
    const events = this.db.prepare(`SELECT summary FROM events ${filter.eventWhere}`).all(filter.params) as Array<{ summary?: string }>;
    const injectedMemoryTokens = memories.reduce((sum, row) => sum + estimateTokens(String(row.summary ?? row.content ?? "")), 0);
    const rawTranscriptTokensAvoided = Math.max(0, events.reduce((sum, row) => sum + estimateTokens(String(row.summary ?? "")), 0) * 3 - injectedMemoryTokens);
    const rawLogTokensAvoided = Math.floor(rawTranscriptTokensAvoided * 0.35);
    const supersededMemoriesExcluded = memories.filter((row) => row.stale_status && row.stale_status !== "active").length;
    return {
      injectedMemoryTokens,
      rawTranscriptTokensAvoided,
      rawLogTokensAvoided,
      supersededMemoriesExcluded,
      retrievedMemoriesUsed: memories.filter((row) => row.stale_status === "active").length,
      openLoopTasksPreserved: memories.filter((row) => row.memory_type === "open_loop").length,
      repeatUserRemindersDetected: memories.filter((row) => /again|from now on|remember/i.test(String(row.content ?? ""))).length,
      netEstimatedTokenSavings: rawTranscriptTokensAvoided + rawLogTokensAvoided - injectedMemoryTokens
    };
  }

  private resilience(textRows: TextRow[]) {
    const checkpointRows = textRows.filter((row) => hasRegex(row.text, CHECKPOINT_REGEX));
    const lastCheckpoint = [...checkpointRows]
      .reverse()
      .map((row) => checkpointFrom(row.text))
      .find((value): value is string => Boolean(value));
    return {
      failureSignals: textRows.filter((row) => FAILURE_REGEX.test(row.text)).length,
      recoverySignals: textRows.filter((row) => RECOVERY_REGEX.test(row.text)).length,
      resumeSignals: textRows.filter((row) => RESUME_REGEX.test(row.text)).length,
      checkpointSignals: checkpointRows.length,
      filesystemVerificationSignals: textRows.filter((row) => FILESYSTEM_VERIFY_REGEX.test(row.text)).length,
      lastCheckpoint,
      longRunningTaskSignals: textRows.filter((row) => LONG_RUNNING_REGEX.test(row.text)).length
    };
  }

  private projectAggregates(filter: QueryFilter, textRows: TextRow[]) {
    const rows = this.db.prepare(`SELECT id, name, root_path, last_seen_at FROM projects ${filter.projectWhere} ORDER BY last_seen_at DESC LIMIT 10`).all(filter.params) as ProjectAggregateRow[];
    return rows.map((row) => {
      const projectText = textRows.filter((textRow) => textRow.project_id === row.id);
      const checkpointRows = projectText.filter((textRow) => hasRegex(textRow.text, CHECKPOINT_REGEX));
      const projectFilter = buildFilter(filter.windowStart, row.id);
      return {
        id: row.id,
        name: row.name,
        rootPath: row.root_path,
        sessions: scalar(this.db, `SELECT COUNT(*) FROM sessions ${projectFilter.sessionWhere}`, projectFilter.params),
        events: scalar(this.db, `SELECT COUNT(*) FROM events ${projectFilter.eventWhere}`, projectFilter.params),
        memories: scalar(this.db, `SELECT COUNT(*) FROM memories ${projectFilter.memoryWhere}`, projectFilter.params),
        contextBriefs: scalar(this.db, `SELECT COUNT(*) FROM metrics ${projectFilter.metricWhereWith("metric_name = 'context_brief_generation_latency'")}`, projectFilter.params),
        checkpointSignals: checkpointRows.length,
        resumeSignals: projectText.filter((textRow) => RESUME_REGEX.test(textRow.text)).length,
        failureSignals: projectText.filter((textRow) => FAILURE_REGEX.test(textRow.text)).length,
        recoverySignals: projectText.filter((textRow) => RECOVERY_REGEX.test(textRow.text)).length,
        lastSeenAt: row.last_seen_at,
        lastCheckpoint: [...checkpointRows]
          .reverse()
          .map((textRow) => checkpointFrom(textRow.text))
          .find((value): value is string => Boolean(value))
      };
    });
  }

  private countLogMatches(pattern: RegExp): number {
    const logPath = join(this.config.storage.home, "logs", "ccm.log");
    if (!existsSync(logPath)) return 0;
    return readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => pattern.test(line)).length;
  }
}

interface QueryFilter {
  params: Record<string, unknown>;
  windowStart: string | null;
  sessionWhere: string;
  eventWhere: string;
  eventJoinWhere: string;
  memoryWhere: string;
  memoryJoinWhere: string;
  metricWhereWith: (extra: string) => string;
  traceWhereWith: (extra: string) => string;
  memoryWhereWith: (extra: string) => string;
  openLoopWhere: string;
  openLoopWhereWith: (extra: string) => string;
  artifactWhere: string;
  projectWhere: string;
}

function buildFilter(windowStart: string | null, projectId?: string, projectName?: string): QueryFilter {
  const params: Record<string, unknown> = {};
  const sessionClauses: string[] = [];
  const eventClauses: string[] = [];
  const memoryClauses: string[] = [];
  const metricClauses: string[] = [];
  const traceClauses: string[] = [];
  const openLoopClauses: string[] = [];
  const artifactClauses: string[] = [];
  const projectClauses: string[] = [];
  if (windowStart) {
    params.windowStart = windowStart;
    sessionClauses.push("last_seen_at >= @windowStart");
    eventClauses.push("created_at >= @windowStart");
    memoryClauses.push("created_at >= @windowStart");
    metricClauses.push("created_at >= @windowStart");
    traceClauses.push("created_at >= @windowStart");
    openLoopClauses.push("created_at >= @windowStart");
    artifactClauses.push("last_seen_at >= @windowStart");
    projectClauses.push("last_seen_at >= @windowStart");
  }
  if (projectId) {
    params.projectId = projectId;
    sessionClauses.push("project_id = @projectId");
    eventClauses.push("project_id = @projectId");
    memoryClauses.push("project_id = @projectId");
    metricClauses.push("project_id = @projectId");
    traceClauses.push("project_id = @projectId");
    openLoopClauses.push("project_id = @projectId");
    artifactClauses.push("project_id = @projectId");
    projectClauses.push("id = @projectId");
  }
  if (!projectId && projectName) {
    params.projectName = projectName;
    params.projectNameLike = `%${projectName}%`;
    const scopedProjectIds = "project_id IN (SELECT id FROM projects WHERE name = @projectName OR root_path LIKE @projectNameLike)";
    sessionClauses.push(scopedProjectIds);
    eventClauses.push(scopedProjectIds);
    memoryClauses.push(scopedProjectIds);
    metricClauses.push(scopedProjectIds);
    traceClauses.push(scopedProjectIds);
    openLoopClauses.push(scopedProjectIds);
    artifactClauses.push(scopedProjectIds);
    projectClauses.push("(name = @projectName OR root_path LIKE @projectNameLike)");
  }
  return {
    params,
    windowStart,
    sessionWhere: where(sessionClauses),
    eventWhere: where(eventClauses),
    eventJoinWhere: prefixedWhere(eventClauses, "e"),
    memoryWhere: where(memoryClauses),
    memoryJoinWhere: prefixedWhere(memoryClauses, "m"),
    metricWhereWith: (extra: string) => where([...metricClauses, extra]),
    traceWhereWith: (extra: string) => where([...traceClauses, extra]),
    memoryWhereWith: (extra: string) => where([...memoryClauses, extra]),
    openLoopWhere: where(openLoopClauses),
    openLoopWhereWith: (extra: string) => where([...openLoopClauses, extra]),
    artifactWhere: where(artifactClauses),
    projectWhere: where(projectClauses)
  };
}

function prefixedWhere(clauses: string[], alias: string): string {
  return where(clauses.map((clause) => clause.replace(/\b(project_id|created_at|last_seen_at)\b/g, `${alias}.$1`)));
}

function where(clauses: string[]): string {
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function scalar(db: Database.Database, sql: string, params: Record<string, unknown>): number {
  const row = db.prepare(sql).get(params) as Record<string, unknown> | undefined;
  return Number(Object.values(row ?? {})[0] ?? 0);
}

function parseSince(since: string): string | null {
  if (since === "all") return null;
  const match = /^(\d+)([dhw])$/.exec(since);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const millis = unit === "h" ? amount * 60 * 60 * 1000 : unit === "d" ? amount * 24 * 60 * 60 * 1000 : amount * 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - millis).toISOString();
}

function hasRegex(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function checkpointFrom(text: string): string | undefined {
  CHECKPOINT_REGEX.lastIndex = 0;
  const matches = [...text.matchAll(CHECKPOINT_REGEX)].map((match) => match[0]);
  return matches.at(-1);
}

function samples(rows: TextRow[], pattern: RegExp, limit: number): string[] {
  return rows
    .filter((row) => hasRegex(row.text, pattern))
    .slice(-limit)
    .map((row) => `${row.project_name ?? "unknown"}: ${trim(row.text, 180)}`);
}

function trim(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function bulletList(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ["- None."];
}

function projectLines(projects: EffectivenessReport["projects"]): string[] {
  if (!projects.length) return ["- None."];
  return projects.map(
    (project) =>
      `- ${project.name}: ${project.sessions} sessions, ${project.contextBriefs} briefs, ${project.checkpointSignals} checkpoint signals, ${project.resumeSignals} resume signals${project.lastCheckpoint ? `, last checkpoint ${project.lastCheckpoint}` : ""}`
  );
}

function publishReadiness(
  summary: EffectivenessReport["summary"],
  effectiveness: EffectivenessReport["effectiveness"],
  resilience: EffectivenessReport["resilience"],
  reliability: EffectivenessReport["reliability"]
): EffectivenessReport["publishReadiness"] {
  const strengths: string[] = [];
  const gaps: string[] = [];
  let score = 35;
  if (summary.contextBriefsGenerated > 0) {
    score += 15;
    strengths.push("CCM is actively generating context briefs.");
  } else gaps.push("No context brief activations observed in the reporting window.");
  if (summary.memoriesStored > 0) {
    score += 10;
    strengths.push("Durable memories are being stored locally.");
  } else gaps.push("No durable memories were stored.");
  if (effectiveness.netEstimatedTokenSavings > 0) {
    score += 10;
    strengths.push("Context dividend is positive in the selected window.");
  } else gaps.push("Token-savings estimate is not yet positive.");
  if (resilience.checkpointSignals > 0 || resilience.resumeSignals > 0) {
    score += 15;
    strengths.push("Resume/checkpoint signals are visible for long-running work.");
  } else gaps.push("No resume/checkpoint evidence detected yet.");
  if (reliability.hookFailuresLogged === 0 && reliability.mcpFailuresLogged === 0) {
    score += 10;
    strengths.push("No hook or MCP failures are logged locally.");
  } else gaps.push("Hook or MCP failures are present in local logs.");
  if (reliability.suspectedSecrets === 0) {
    score += 5;
    strengths.push("No obvious secret material appears in stored report text.");
  } else gaps.push("Secret/redaction indicators should be reviewed before publishing examples.");
  const bounded = Math.max(0, Math.min(100, score));
  return {
    score: bounded,
    verdict: bounded >= 80 ? "Strong open-source candidate once documented with real examples." : bounded >= 60 ? "Promising, but gather more real-task evidence before publishing broadly." : "Needs more usage data before claiming effectiveness.",
    strengths,
    gaps
  };
}
