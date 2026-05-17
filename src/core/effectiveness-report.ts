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
    explicitMcpRecords: number;
    passiveHookEvents: number;
    captureMode: "none" | "explicit_mcp_only" | "passive_hooks_only" | "explicit_mcp_and_passive_hooks";
    latestExplicitMcpAt?: string;
    latestPassiveHookAt?: string;
    explicitMcpAgeHours?: number;
    passiveHookAgeHours?: number;
    passiveHookStatus: "recent" | "stale" | "not_seen";
    passiveHookCoverage: number;
    suspectedSecrets: number;
  };
  memoryPressure: {
    level: "low" | "moderate" | "high" | "critical";
    totalMemories: number;
    activeMemories: number;
    inactiveMemories: number;
    estimatedActiveMemoryTokens: number;
    retrievedMemoriesUsed: number;
    memoryToBriefRatio: number;
    recommendations: string[];
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
  event_type?: string;
  text: string;
  created_at: string;
}

interface ProjectAggregateRow {
  id: string;
  name: string;
  root_path?: string;
  last_seen_at: string;
}

const CHECKPOINT_FILE_REGEX = /\b(?:page[_ -]?\d{1,4}\.(?:png|jpg|jpeg)|page[_ -]?\d{1,4}|title_page\.(?:png|jpg|jpeg)|contact_sheet[^ \n]*)\b/gi;
const CHECKPOINT_REGEX = /\b(?:page[_ -]?\d{1,4}\.(?:png|jpg|jpeg)|page[_ -]?\d{1,4}|title_page\.(?:png|jpg|jpeg)|contact_sheet[^ \n]*|checkpoint|last confirmed|confirmed on disk|disk confirms|filesystem checkpoint)\b/gi;
const RESUME_REGEX = /\b(?:resume|resuming|resumed|continue from|pick(?:ed)? up|restart(?:ed)? from|recover(?:ed|y|ing)?|handoff|session handoff)\b/i;
const RECOVERY_REGEX = /\b(?:recovered|recovery|resumed|resuming|continued from|verified on disk|disk confirms|last confirmed|picked up)\b/i;
const FAILURE_SIGNAL_REGEX = /\b(?:failure checkpoint|failed because|failed with|command failed|build failed|test failed|tests failed|crash(?:ed)?|die(?:d|s)?|chok(?:e|ed|es|ing)|timeout|timed out|interrupted|stuck|loop(?:ing)?|reconnect|disconnect|blocked|rejected)\b/i;
const NEGATED_FAILURE_REGEX = /\b(?:no|without|zero)\s+(?:warning|warnings|error|errors|failure|failures)\b|warning-free|error-free|clean-builds?|succeeded with no|no warning\/error|no error matches/i;
const LONG_RUNNING_REGEX = /\b(?:long[- ]running|full manga|volume|batch|pages? \d{1,4}|\d{1,4}[- ]page|production run|checkpoint-heavy)\b/i;
const FILESYSTEM_VERIFY_REGEX = /\b(?:disk confirms|confirmed on disk|verified on disk|filesystem|finder verification|ls confirms|reading image_source_map|source_map)\b/i;
const SECRET_REGEX = /\b(?:redacted:[a-z0-9_-]+|REDACTED_[A-Z0-9_]+|(?:api[_ -]?key|token|secret|password|private[_ -]?key)\s*[:=]|sk-[A-Za-z0-9_-]{16,})\b/i;
const EXPLICIT_MCP_SOURCE_REGEX = /\b(?:record_decision|compact_session|get_working_context|get_effectiveness_report)\b/;
const RECENT_PASSIVE_HOOK_HOURS = 48;

export class EffectivenessReportService {
  constructor(
    private readonly db: Database.Database,
    private readonly config: CcmConfig
  ) {}

  report(options: EffectivenessReportOptions = {}): EffectivenessReport {
    const windowStart = parseSince(options.since ?? "7d");
    const projectId = options.projectId;
    const sampleLimit = options.sampleLimit ?? 5;
    const filter = buildFilter(windowStart, projectId, projectId ? undefined : options.projectName);
    const recencyFilter = buildFilter(null, projectId, projectId ? undefined : options.projectName);
    const textRows = this.textRows(filter);
    const summary = this.summary(filter);
    const resilience = this.resilience(textRows);
    const dividend = this.filteredDividend(filter);
    const memoryPressure = this.memoryPressure(filter, dividend.retrievedMemoriesUsed, summary.contextBriefsGenerated);
    const projects = this.projectAggregates(filter, textRows);
    const passiveHookEvents = summary.hookEvents;
    const explicitMcpRecords = this.explicitMcpRecords(filter);
    const latestPassiveHookAt = this.latestTraceAt(recencyFilter, "hook");
    const latestExplicitMcpAt = this.latestExplicitMcpAt(recencyFilter);
    const passiveHookAgeHours = ageHours(latestPassiveHookAt);
    const explicitMcpAgeHours = ageHours(latestExplicitMcpAt);
    const reliability = {
      hookFailuresLogged: this.countLogMatches(/Hook .*failure|Hook failed/i),
      mcpFailuresLogged: this.countLogMatches(/MCP server failed/i),
      explicitMcpRecords,
      passiveHookEvents,
      captureMode: captureMode(explicitMcpRecords, passiveHookEvents),
      latestExplicitMcpAt,
      latestPassiveHookAt,
      explicitMcpAgeHours,
      passiveHookAgeHours,
      passiveHookStatus: passiveHookStatus(latestPassiveHookAt, passiveHookAgeHours),
      passiveHookCoverage: summary.contextBriefsGenerated ? round(passiveHookEvents / summary.contextBriefsGenerated, 3) : passiveHookEvents > 0 ? 1 : 0,
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
      checkpointSamples: samples(textRows, (row) => hasRegex(row.text, CHECKPOINT_REGEX), sampleLimit),
      recoverySamples: samples(textRows, RECOVERY_REGEX, sampleLimit),
      failureSamples: samples(textRows, isFailureSignal, sampleLimit)
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
      memoryPressure,
      projects,
      evidence,
      publishReadiness: publishReadiness(summary, effectiveness, resilience, reliability, memoryPressure)
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
      "## Memory Pressure",
      "",
      `- Level: ${report.memoryPressure.level}`,
      `- Active memories: ${report.memoryPressure.activeMemories}/${report.memoryPressure.totalMemories}`,
      `- Estimated active memory tokens: ${report.memoryPressure.estimatedActiveMemoryTokens}`,
      `- Retrieved memories used: ${report.memoryPressure.retrievedMemoriesUsed}`,
      `- Memory-to-brief ratio: ${report.memoryPressure.memoryToBriefRatio}`,
      "Recommendations:",
      ...bulletList(report.memoryPressure.recommendations),
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
      `- Explicit MCP records captured: ${report.reliability.explicitMcpRecords}`,
      `- Passive hook events captured: ${report.reliability.passiveHookEvents}`,
      `- Capture mode: ${report.reliability.captureMode}`,
      `- Latest explicit MCP record: ${report.reliability.latestExplicitMcpAt ?? "none detected"}`,
      `- Latest passive hook event: ${report.reliability.latestPassiveHookAt ?? "none detected"}`,
      `- Passive hook status: ${report.reliability.passiveHookStatus}${typeof report.reliability.passiveHookAgeHours === "number" ? ` (${report.reliability.passiveHookAgeHours}h old)` : ""}`,
      `- Passive hook coverage: ${report.reliability.passiveHookCoverage} hook traces/context brief`,
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
    const projectsObserved = scalar(this.db, `SELECT COUNT(DISTINCT COALESCE(p.root_path, s.project_id)) FROM sessions s LEFT JOIN projects p ON p.id = s.project_id ${filter.sessionJoinWhere}`, filter.params);
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
        `SELECT e.project_id, p.name AS project_name, p.root_path, e.session_id, e.event_type, (COALESCE(e.title, '') || ' ' || e.summary) AS text, e.created_at
         FROM events e LEFT JOIN projects p ON p.id = e.project_id ${filter.eventJoinWhere}`
      )
      .all(filter.params) as TextRow[];
    const memoryRows = this.db
      .prepare(
        `SELECT m.project_id, p.name AS project_name, p.root_path, m.session_id, m.event_type, (COALESCE(m.summary, '') || ' ' || m.content) AS text, m.created_at
         FROM memories m LEFT JOIN projects p ON p.id = m.project_id ${filter.memoryJoinWhere}`
      )
      .all(filter.params) as TextRow[];
    return [...eventRows, ...memoryRows].sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private explicitMcpRecords(filter: QueryFilter): number {
    const eventRows = this.db.prepare(`SELECT source_refs_json FROM events ${filter.eventWhere}`).all(filter.params) as Array<{ source_refs_json?: string }>;
    const memoryRows = this.db.prepare(`SELECT source_refs_json FROM memories ${filter.memoryWhere}`).all(filter.params) as Array<{ source_refs_json?: string }>;
    return [...eventRows, ...memoryRows].filter((row) => EXPLICIT_MCP_SOURCE_REGEX.test(String(row.source_refs_json ?? ""))).length;
  }

  private latestTraceAt(filter: QueryFilter, traceType: string): string | undefined {
    const row = this.db
      .prepare(`SELECT created_at FROM trace_entries ${filter.traceWhereWith("trace_type = @latestTraceType")} ORDER BY created_at DESC LIMIT 1`)
      .get({ ...filter.params, latestTraceType: traceType }) as { created_at?: string } | undefined;
    return row?.created_at;
  }

  private latestExplicitMcpAt(filter: QueryFilter): string | undefined {
    const rows = [
      ...(this.db.prepare(`SELECT source_refs_json, created_at FROM events ${filter.eventWhere}`).all(filter.params) as Array<{
        source_refs_json?: string;
        created_at?: string;
      }>),
      ...(this.db.prepare(`SELECT source_refs_json, created_at FROM memories ${filter.memoryWhere}`).all(filter.params) as Array<{
        source_refs_json?: string;
        created_at?: string;
      }>)
    ];
    return rows
      .filter((row) => EXPLICIT_MCP_SOURCE_REGEX.test(String(row.source_refs_json ?? "")) && typeof row.created_at === "string")
      .map((row) => String(row.created_at))
      .sort()
      .at(-1);
  }

  private filteredDividend(filter: QueryFilter) {
    const memories = this.db
      .prepare(`SELECT id, content, summary, stale_status, memory_type FROM memories ${filter.memoryWhere}`)
      .all(filter.params) as Array<{ id?: string; content?: string; summary?: string; stale_status?: string; memory_type?: string }>;
    const events = this.db.prepare(`SELECT summary FROM events ${filter.eventWhere}`).all(filter.params) as Array<{ summary?: string }>;
    const metricRows = this.db
      .prepare(`SELECT metadata_json FROM metrics ${filter.metricWhereWith("metric_name = 'context_brief_generation_latency'")}`)
      .all(filter.params) as Array<{ metadata_json?: string }>;
    const metricMetadata = metricRows.map((row) => parseMetadata(row.metadata_json));
    const metricInjectedTokens = metricMetadata.reduce((sum, metadata) => sum + numberFromMetadata(metadata.tokens), 0);
    const retrievalTraceRows = this.db
      .prepare(`SELECT payload_json FROM trace_entries ${filter.traceWhereWith("trace_type = 'retrieval'")}`)
      .all(filter.params) as Array<{ payload_json?: string }>;
    const retrievalInjectedTokens = retrievalTraceRows.reduce((sum, row) => sum + selectedTraceTokenTotal(parseMetadata(row.payload_json)), 0);
    const retrievedMemoryIds = new Set<string>();
    for (const metadata of metricMetadata) {
      const memoryIds = Array.isArray(metadata.memoryIds) ? metadata.memoryIds : [];
      for (const memoryId of memoryIds) {
        if (typeof memoryId === "string") retrievedMemoryIds.add(memoryId);
      }
    }
    const fallbackInjectedMemoryTokens = memories.reduce((sum, row) => sum + estimateTokens(String(row.summary ?? row.content ?? "")), 0);
    const injectedMemoryTokens = retrievalInjectedTokens > 0 ? retrievalInjectedTokens : metricInjectedTokens > 0 ? metricInjectedTokens : fallbackInjectedMemoryTokens;
    const eventTokens = events.reduce((sum, row) => sum + estimateTokens(String(row.summary ?? "")), 0);
    const reuseMultiplier = Math.min(4, Math.max(1, Math.log2(Math.max(metricRows.length, retrievalTraceRows.length, 1) + 1)));
    const rawTranscriptTokensAvoided = Math.floor(eventTokens * 3 * reuseMultiplier);
    const rawLogTokensAvoided = Math.floor(rawTranscriptTokensAvoided * 0.35);
    const supersededMemoriesExcluded = memories.filter((row) => row.stale_status && row.stale_status !== "active").length;
    return {
      injectedMemoryTokens,
      rawTranscriptTokensAvoided,
      rawLogTokensAvoided,
      supersededMemoriesExcluded,
      retrievedMemoriesUsed: retrievedMemoryIds.size || memories.filter((row) => row.stale_status === "active").length,
      openLoopTasksPreserved: memories.filter((row) => row.memory_type === "open_loop").length,
      repeatUserRemindersDetected: memories.filter((row) => /again|from now on|remember/i.test(String(row.content ?? ""))).length,
      netEstimatedTokenSavings: rawTranscriptTokensAvoided + rawLogTokensAvoided - injectedMemoryTokens
    };
  }

  private memoryPressure(filter: QueryFilter, retrievedMemoriesUsed: number, contextBriefsGenerated: number): EffectivenessReport["memoryPressure"] {
    const memories = this.db
      .prepare(`SELECT content, summary, stale_status FROM memories ${filter.memoryWhere}`)
      .all(filter.params) as Array<{ content?: string; summary?: string; stale_status?: string }>;
    const totalMemories = memories.length;
    const activeMemories = memories.filter((memory) => memory.stale_status === "active").length;
    const inactiveMemories = totalMemories - activeMemories;
    const estimatedActiveMemoryTokens = memories
      .filter((memory) => memory.stale_status === "active")
      .reduce((sum, row) => sum + estimateTokens(String(row.summary ?? row.content ?? "")), 0);
    const memoryToBriefRatio = contextBriefsGenerated ? round(activeMemories / contextBriefsGenerated, 2) : activeMemories;
    const level = memoryPressureLevel({ activeMemories, estimatedActiveMemoryTokens, memoryToBriefRatio });
    return {
      level,
      totalMemories,
      activeMemories,
      inactiveMemories,
      estimatedActiveMemoryTokens,
      retrievedMemoriesUsed,
      memoryToBriefRatio,
      recommendations: memoryPressureRecommendations({
        level,
        activeMemories,
        inactiveMemories,
        estimatedActiveMemoryTokens,
        memoryToBriefRatio,
        retrievedMemoriesUsed
      })
    };
  }

  private resilience(textRows: TextRow[]) {
    const checkpointRows = uniqueSignalRows(textRows, (row) => hasRegex(row.text, CHECKPOINT_REGEX));
    const lastCheckpoint = [...checkpointRows]
      .reverse()
      .map((row) => checkpointFrom(row.text))
      .find((value): value is string => Boolean(value));
    return {
      failureSignals: uniqueSignalRows(textRows, isFailureSignal).length,
      recoverySignals: uniqueSignalRows(textRows, (row) => RECOVERY_REGEX.test(row.text)).length,
      resumeSignals: uniqueSignalRows(textRows, (row) => RESUME_REGEX.test(row.text)).length,
      checkpointSignals: checkpointRows.length,
      filesystemVerificationSignals: uniqueSignalRows(textRows, (row) => FILESYSTEM_VERIFY_REGEX.test(row.text)).length,
      lastCheckpoint,
      longRunningTaskSignals: uniqueSignalRows(textRows, (row) => LONG_RUNNING_REGEX.test(row.text)).length
    };
  }

  private projectAggregates(filter: QueryFilter, textRows: TextRow[]) {
    const rows = this.db.prepare(`SELECT id, name, root_path, last_seen_at FROM projects ${filter.projectWhere} ORDER BY last_seen_at DESC LIMIT 10`).all(filter.params) as ProjectAggregateRow[];
    const groups = projectGroups(rows);
    return groups.map((group) => {
      const projectText = textRows.filter((textRow) => Boolean(textRow.project_id && group.ids.includes(textRow.project_id)));
      const checkpointRows = uniqueSignalRows(projectText, (textRow) => hasRegex(textRow.text, CHECKPOINT_REGEX));
      const projectFilter = buildFilter(filter.windowStart, undefined, undefined, group.ids);
      return {
        id: group.ids[0],
        name: group.name,
        rootPath: group.rootPath,
        sessions: scalar(this.db, `SELECT COUNT(*) FROM sessions ${projectFilter.sessionWhere}`, projectFilter.params),
        events: scalar(this.db, `SELECT COUNT(*) FROM events ${projectFilter.eventWhere}`, projectFilter.params),
        memories: scalar(this.db, `SELECT COUNT(*) FROM memories ${projectFilter.memoryWhere}`, projectFilter.params),
        contextBriefs: scalar(this.db, `SELECT COUNT(*) FROM metrics ${projectFilter.metricWhereWith("metric_name = 'context_brief_generation_latency'")}`, projectFilter.params),
        checkpointSignals: checkpointRows.length,
        resumeSignals: uniqueSignalRows(projectText, (textRow) => RESUME_REGEX.test(textRow.text)).length,
        failureSignals: uniqueSignalRows(projectText, isFailureSignal).length,
        recoverySignals: uniqueSignalRows(projectText, (textRow) => RECOVERY_REGEX.test(textRow.text)).length,
        lastSeenAt: group.lastSeenAt,
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
  sessionJoinWhere: string;
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

function buildFilter(windowStart: string | null, projectId?: string, projectName?: string, projectIds?: string[]): QueryFilter {
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
  if (!projectId && projectIds?.length) {
    const placeholders = projectIds.map((id, index) => {
      const key = `projectId${index}`;
      params[key] = id;
      return `@${key}`;
    });
    const scopedProjectIds = `project_id IN (${placeholders.join(", ")})`;
    sessionClauses.push(scopedProjectIds);
    eventClauses.push(scopedProjectIds);
    memoryClauses.push(scopedProjectIds);
    metricClauses.push(scopedProjectIds);
    traceClauses.push(scopedProjectIds);
    openLoopClauses.push(scopedProjectIds);
    artifactClauses.push(scopedProjectIds);
    projectClauses.push(`id IN (${placeholders.join(", ")})`);
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
    sessionJoinWhere: prefixedWhere(sessionClauses, "s"),
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

function isFailureSignal(row: TextRow): boolean {
  if (row.event_type === "failure") return true;
  if (!FAILURE_SIGNAL_REGEX.test(row.text)) return false;
  FAILURE_SIGNAL_REGEX.lastIndex = 0;
  return !NEGATED_FAILURE_REGEX.test(row.text);
}

function captureMode(explicitMcpRecords: number, passiveHookEvents: number): EffectivenessReport["reliability"]["captureMode"] {
  if (explicitMcpRecords > 0 && passiveHookEvents > 0) return "explicit_mcp_and_passive_hooks";
  if (explicitMcpRecords > 0) return "explicit_mcp_only";
  if (passiveHookEvents > 0) return "passive_hooks_only";
  return "none";
}

function passiveHookStatus(latestPassiveHookAt?: string, passiveHookAgeHours?: number): EffectivenessReport["reliability"]["passiveHookStatus"] {
  if (!latestPassiveHookAt) return "not_seen";
  return typeof passiveHookAgeHours === "number" && passiveHookAgeHours <= RECENT_PASSIVE_HOOK_HOURS ? "recent" : "stale";
}

function ageHours(iso?: string): number | undefined {
  if (!iso) return undefined;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return undefined;
  return round((Date.now() - time) / (60 * 60 * 1000), 1);
}

function parseMetadata(json?: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function numberFromMetadata(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function selectedTraceTokenTotal(payload: Record<string, unknown>): number {
  const selected = Array.isArray(payload.selected) ? payload.selected : [];
  return selected.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    return sum + numberFromMetadata((item as Record<string, unknown>).tokenEstimate);
  }, 0);
}

function memoryPressureLevel(input: { activeMemories: number; estimatedActiveMemoryTokens: number; memoryToBriefRatio: number }): EffectivenessReport["memoryPressure"]["level"] {
  if (input.activeMemories >= 750 || input.estimatedActiveMemoryTokens >= 75000 || input.memoryToBriefRatio >= 75) return "critical";
  if (input.activeMemories >= 300 || input.estimatedActiveMemoryTokens >= 35000 || input.memoryToBriefRatio >= 40) return "high";
  if (input.activeMemories >= 120 || input.estimatedActiveMemoryTokens >= 15000 || input.memoryToBriefRatio >= 20) return "moderate";
  return "low";
}

function memoryPressureRecommendations(input: {
  level: EffectivenessReport["memoryPressure"]["level"];
  activeMemories: number;
  inactiveMemories: number;
  estimatedActiveMemoryTokens: number;
  memoryToBriefRatio: number;
  retrievedMemoriesUsed: number;
}): string[] {
  const recommendations: string[] = [];
  if (input.level === "high" || input.level === "critical") {
    recommendations.push("Run hygiene review/archive for stale episodic handoffs and low-salience memories before using publish-readiness claims.");
  }
  if (input.memoryToBriefRatio >= 20) {
    recommendations.push("Reduce memory-to-brief pressure by consolidating repeated session handoffs into durable project-state summaries.");
  }
  if (input.estimatedActiveMemoryTokens >= 35000) {
    recommendations.push("Prefer summaries and retrieval traces over retaining raw or repeated long-form memory content.");
  }
  if (input.inactiveMemories > 0) {
    recommendations.push("Keep non-active memories excluded from retrieval and export examples unless explicitly requested.");
  }
  if (input.retrievedMemoriesUsed === 0 && input.activeMemories > 0) {
    recommendations.push("Generate at least one working-context brief to confirm active memories are retrievable.");
  }
  return recommendations;
}

function projectGroups(rows: ProjectAggregateRow[]): Array<{ ids: string[]; name: string; rootPath?: string; lastSeenAt: string }> {
  const groups = new Map<string, { ids: string[]; name: string; rootPath?: string; lastSeenAt: string }>();
  for (const row of rows) {
    const key = row.root_path ? `root:${row.root_path}` : `id:${row.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(row.id);
      if (row.last_seen_at > existing.lastSeenAt) {
        existing.name = row.name;
        existing.lastSeenAt = row.last_seen_at;
      }
      continue;
    }
    groups.set(key, { ids: [row.id], name: row.name, rootPath: row.root_path, lastSeenAt: row.last_seen_at });
  }
  return [...groups.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)).slice(0, 10);
}

function uniqueSignalRows(rows: TextRow[], matcher: (row: TextRow) => boolean): TextRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!matcher(row)) return false;
    const key = signalKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function signalKey(row: TextRow): string {
  const words = row.text
    .replace(/^Decision recorded\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ");
  const half = words.length / 2;
  const compactWords =
    Number.isInteger(half) && words.slice(0, half).join(" ") === words.slice(half).join(" ") ? words.slice(0, half) : words;
  return `${row.project_id ?? "unknown"}:${compactWords.join(" ").slice(0, 300)}`;
}

function checkpointFrom(text: string): string | undefined {
  CHECKPOINT_FILE_REGEX.lastIndex = 0;
  const fileMatches = [...text.matchAll(CHECKPOINT_FILE_REGEX)].map((match) => match[0]);
  if (fileMatches.length) return fileMatches.at(-1);
  CHECKPOINT_REGEX.lastIndex = 0;
  const matches = [...text.matchAll(CHECKPOINT_REGEX)].map((match) => match[0]);
  return matches.at(-1);
}

function samples(rows: TextRow[], matcher: RegExp | ((row: TextRow) => boolean), limit: number): string[] {
  return uniqueSignalRows(rows, (row) => (matcher instanceof RegExp ? hasRegex(row.text, matcher) : matcher(row)))
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
  reliability: EffectivenessReport["reliability"],
  memoryPressure: EffectivenessReport["memoryPressure"]
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
  if (reliability.mcpFailuresLogged === 0 && reliability.explicitMcpRecords > 0) {
    score += 8;
    strengths.push("Explicit MCP record capture is working.");
  } else if (reliability.mcpFailuresLogged > 0) gaps.push("MCP failures are present in local logs.");
  else gaps.push("No explicit MCP records were captured.");
  if (reliability.passiveHookStatus === "recent" && reliability.hookFailuresLogged === 0) {
    score += 5;
    strengths.push("Passive hook capture is verified.");
  } else if (reliability.hookFailuresLogged > 0) gaps.push("Hook failures are present in local logs.");
  else if (reliability.passiveHookStatus === "stale")
    gaps.push(`Passive hook capture is stale; latest hook was ${reliability.passiveHookAgeHours ?? "unknown"} hours ago.`);
  else gaps.push("No passive hook events have been observed yet.");
  if (reliability.suspectedSecrets === 0) {
    score += 5;
    strengths.push("No obvious secret material appears in stored report text.");
  } else gaps.push("Secret/redaction indicators should be reviewed before publishing examples.");
  if (memoryPressure.level === "low" || memoryPressure.level === "moderate") {
    strengths.push(`Memory pressure is ${memoryPressure.level}.`);
  } else {
    score -= memoryPressure.level === "critical" ? 10 : 5;
    gaps.push(`Memory pressure is ${memoryPressure.level}; active memory volume may reduce context dividend quality.`);
  }
  const recencyCappedScore =
    reliability.passiveHookStatus === "recent" ? score : Math.min(score, reliability.passiveHookStatus === "stale" ? 90 : 88);
  const bounded = Math.max(0, Math.min(100, recencyCappedScore));
  const verdict =
    reliability.passiveHookStatus !== "recent" && bounded >= 80
      ? "Strong explicit-use candidate; refresh passive-hook evidence before claiming always-on safety-net behavior."
      : bounded >= 80
        ? "Strong open-source candidate once documented with real examples."
        : bounded >= 60
          ? "Promising, but gather more real-task evidence before publishing broadly."
          : "Needs more usage data before claiming effectiveness.";
  return {
    score: bounded,
    verdict,
    strengths,
    gaps
  };
}
