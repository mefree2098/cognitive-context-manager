import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";
import { AgentsSuggestionService } from "../../src/core/agents-suggestions.js";
import { BenchService } from "../../src/core/bench-service.js";
import { backupDatabase, schemaStatus, verifyDatabase } from "../../src/core/db-admin.js";
import { EmbeddingService } from "../../src/core/embedding-provider.js";
import { EffectivenessReportService } from "../../src/core/effectiveness-report.js";
import { recordHookAttempt } from "../../src/core/hook-attempt-log.js";
import { HygieneService } from "../../src/core/hygiene.js";
import { SyncService } from "../../src/core/sync-service.js";
import { CcmService } from "../../src/core/consolidator.js";
import { runDoctorWithOptions } from "../../src/cli/commands/doctor.js";
import { readUiState, startUiServer } from "../../src/core/ui-server.js";
import { openDb } from "../../src/storage/db.js";

let home: string;
let repo: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-post-"));
  repo = mkdtempSync(join(tmpdir(), "ccm-repo-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("post-MVP features", () => {
  it("tracks schema status, backups, traces, and context dividend", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const project = service.ensureProjectSession(repo).project;
      service.recordDecision({ projectId: project.id, decision: "Use Fastify for API work.", source: "user" });
      const brief = service.getWorkingContext({ task: "scaffold API", repoPath: repo });
      expect(brief.working_context_brief).toContain("CCM_CONTEXT_BRIEF_START");
      expect(service.traces.latest("retrieval")?.payload).toBeTruthy();
      expect(service.contextDividend().netEstimatedTokenSavings).toBeGreaterThanOrEqual(0);
      expect(schemaStatus(context.db).ok).toBe(true);
      expect(verifyDatabase(context.db).ok).toBe(true);
      expect(existsSync(backupDatabase(repo))).toBe(true);
    } finally {
      context.db.close();
    }
  });

  it("reports long-running task effectiveness and resume checkpoints", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const { project, session } = service.ensureProjectSession(repo, "manga");
      service.events.create({
        projectId: project.id,
        sessionId: session.id,
        eventType: "failure",
        title: "Generation stalled",
        summary: "The full manga generation choked during a long-running batch and needs recovery.",
        entities: [],
        sourceRefs: [],
        salience: 0.9,
        confidence: 0.8
      });
      service.events.create({
        projectId: project.id,
        sessionId: session.id,
        eventType: "artifact_change",
        title: "Resume checkpoint",
        summary: "Disk confirms title_page.png plus page_001.png through page_012.png; resuming at page_013.png.",
        entities: [],
        sourceRefs: [],
        salience: 0.9,
        confidence: 0.85
      });
      service.events.create({
        projectId: project.id,
        sessionId: session.id,
        eventType: "test_result",
        title: "Verification passed",
        summary: "QA passed and production verified after resuming from the filesystem checkpoint.",
        entities: [],
        sourceRefs: [],
        salience: 0.86,
        confidence: 0.85
      });
      service.events.create({
        projectId: project.id,
        sessionId: session.id,
        eventType: "implementation_step",
        title: "Task completed",
        summary: "Completed the resumed manga recovery and verified the final artifact order.",
        entities: [],
        sourceRefs: [],
        salience: 0.82,
        confidence: 0.85
      });
      service.getWorkingContext({ task: "resume manga from page_013.png", repoPath: repo, projectName: "manga" });
      service.compactSession({ repoPath: repo, projectId: project.id, sessionId: session.id });

      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all", projectName: "manga" });
      expect(report.resilience.failureSignals).toBeGreaterThan(0);
      expect(report.resilience.resumeSignals).toBeGreaterThan(0);
      expect(report.resilience.checkpointSignals).toBeGreaterThan(0);
      expect(report.resilience.lastCheckpoint).toBe("page_013.png");
      expect(report.executionImpact.verificationSignals).toBeGreaterThan(0);
      expect(report.executionImpact.completionSignals).toBeGreaterThan(0);
      expect(report.executionImpact.compactionSignals).toBeGreaterThan(0);
      expect(report.executionImpact.executionContinuityScore).toBeGreaterThanOrEqual(80);
      expect(report.summary.contextBriefsGenerated).toBeGreaterThan(0);
      const markdown = new EffectivenessReportService(context.db, loadConfig(repo)).renderMarkdown(report);
      expect(markdown).toContain("Long-Running Task Resilience");
      expect(markdown).toContain("Execution Impact");
    } finally {
      context.db.close();
    }
  });

  it("caps execution-impact score when completion evidence is missing", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const { project, session } = service.ensureProjectSession(repo, "qa-only");
      service.events.create({
        projectId: project.id,
        sessionId: session.id,
        eventType: "test_result",
        title: "Verification passed",
        summary: "Tests passed and checkpoint verification succeeded after resuming the task.",
        entities: [],
        sourceRefs: [],
        salience: 0.85,
        confidence: 0.85
      });
      service.getWorkingContext({ task: "continue QA-only task", repoPath: repo, projectName: "qa-only" });

      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all", projectName: "qa-only" });
      expect(report.executionImpact.verificationSignals).toBeGreaterThan(0);
      expect(report.executionImpact.completionSignals).toBe(0);
      expect(report.executionImpact.executionContinuityScore).toBeLessThanOrEqual(78);
      expect(report.executionImpact.verdict).toContain("Promising");
    } finally {
      context.db.close();
    }
  });

  it("dedupes same-root report projects and avoids negated failure false positives", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const { project } = service.ensureProjectSession(repo, "RecipeVault");
      const upserted = service.projects.upsert({
        ...project,
        id: "project_remote_after_publish",
        gitRemote: "https://github.com/mefree2098/RecipeVault.git"
      });
      expect(upserted.id).toBe(project.id);

      service.recordDecision({
        projectId: project.id,
        decision: "Verification checkpoint: clean xcodebuild succeeded with no warning/error lines.",
        source: "codex"
      });

      const now = new Date().toISOString();
      const legacyProjectId = "project_legacy_remote_duplicate";
      const legacySessionId = "session_legacy_remote_duplicate";
      context.db
        .prepare(
          `INSERT INTO projects(id, name, root_path, git_remote, git_branch, created_at, updated_at, last_seen_at, metadata_json)
           VALUES (?, 'RecipeVault', ?, 'https://github.com/mefree2098/RecipeVault.git', 'main', ?, ?, ?, '{}')`
        )
        .run(legacyProjectId, repo, now, now, now);
      context.db
        .prepare(
          `INSERT INTO sessions(id, project_id, codex_session_id, started_at, last_seen_at, status, metadata_json)
           VALUES (?, ?, NULL, ?, ?, 'active', '{}')`
        )
        .run(legacySessionId, legacyProjectId, now, now);
      service.recordDecision({
        projectId: legacyProjectId,
        decision: "Build failure checkpoint: first xcodebuild failed because ContentView used an unavailable initializer.",
        source: "codex"
      });
      service.getWorkingContext({ task: "resume RecipeVault QA", repoPath: repo, projectName: "RecipeVault" });

      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all", projectName: "RecipeVault" });
      expect(report.summary.projectsObserved).toBe(1);
      expect(report.summary.sessionsObserved).toBe(2);
      expect(report.projects).toHaveLength(1);
      expect(report.projects[0]?.sessions).toBe(2);
      expect(report.resilience.failureSignals).toBe(1);
      expect(report.evidence.failureSamples.join("\n")).not.toContain("no warning/error");
      expect(report.reliability.explicitMcpRecords).toBeGreaterThan(0);
      expect(report.reliability.passiveHookEvents).toBe(0);
      expect(report.reliability.captureMode).toBe("explicit_mcp_only");
      expect(report.publishReadiness.gaps).toContain("No passive hook events have been observed yet.");
    } finally {
      context.db.close();
    }
  });

  it("reports stale passive hooks and memory pressure without overstating readiness", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const { project, session } = service.ensureProjectSession(repo, "cognitive-context-manager");
      const staleHookAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      context.db
        .prepare(
          `INSERT INTO trace_entries(id, project_id, session_id, trace_type, title, payload_json, created_at)
           VALUES ('trace_stale_hook', ?, ?, 'hook', 'UserPromptSubmit', '{}', ?)`
        )
        .run(project.id, session.id, staleHookAt);

      for (let index = 0; index < 320; index += 1) {
        service.memories.create({
          projectId: project.id,
          sessionId: session.id,
          memoryType: "semantic",
          content: `Repeated historical handoff ${index}: this long memory should create pressure but should not be counted as injected unless retrieval selected it. ${"context ".repeat(20)}`
        });
      }
      service.recordDecision({
        projectId: project.id,
        decision: "Explicit MCP report decision should be counted separately from stale passive hooks.",
        source: "codex"
      });
      service.getWorkingContext({ task: "audit CCM report quality", repoPath: repo, projectName: "cognitive-context-manager" });

      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all", projectName: "cognitive-context-manager" });
      expect(report.reliability.passiveHookEvents).toBe(1);
      expect(report.reliability.passiveHookStatus).toBe("stale");
      expect(report.reliability.latestPassiveHookAt).toBe(staleHookAt);
      expect(report.reliability.passiveHookWatchdog).toBe("mcp_active_but_hooks_absent");
      expect(report.reliability.passiveHookProof).toBe("not_proven");
      expect(report.reliability.explicitMcpRecords).toBeGreaterThan(0);
      expect(report.publishReadiness.gaps.some((gap) => gap.includes("Passive hook capture is stale"))).toBe(true);
      expect(report.publishReadiness.strengths).not.toContain("Passive hook capture is verified.");
      expect(["high", "critical"]).toContain(report.memoryPressure.level);
      expect(report.memoryPressure.recommendations.length).toBeGreaterThan(0);
      expect(report.effectiveness.estimatedInjectedMemoryTokens).toBeLessThan(report.memoryPressure.estimatedActiveMemoryTokens);
      expect(new EffectivenessReportService(context.db, loadConfig(repo)).renderMarkdown(report)).toContain("## Memory Pressure");
    } finally {
      context.db.close();
    }
  });

  it("runs a hook self-test without counting it as passive hook evidence", async () => {
    const checks = await runDoctorWithOptions(repo, { hookSelfTest: true });
    expect(checks.find((check) => check.name === "Hook entrypoint self-test")?.ok).toBe(true);

    const context = openDb(repo);
    try {
      const selfTestHooks = context.db
        .prepare("SELECT COUNT(*) AS count FROM trace_entries WHERE trace_type = 'hook' AND COALESCE(json_extract(payload_json, '$.selfTest'), 0) = 1")
        .get() as { count: number };
      expect(Number(selfTestHooks.count)).toBe(1);
      const service = new CcmService({ db: context.db, repoPath: repo });
      const { project } = service.ensureProjectSession(repo, "cognitive-context-manager");
      const now = new Date().toISOString();
      context.db
        .prepare(
          `INSERT INTO sessions(id, project_id, codex_session_id, started_at, last_seen_at, status, metadata_json)
           VALUES ('session_legacy_doctor_self_test', ?, 'ccm-doctor-self-test-legacy', ?, ?, 'active', '{}')`
        )
        .run(project.id, now, now);
      context.db
        .prepare(
          `INSERT INTO trace_entries(id, project_id, session_id, trace_type, title, payload_json, created_at)
           VALUES ('trace_legacy_doctor_self_test', ?, 'session_legacy_doctor_self_test', 'hook', 'UserPromptSubmit', '{"eventType":"user_prompt"}', ?)`
        )
        .run(project.id, now);
      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all" });
      expect(report.summary.hookEvents).toBe(0);
      expect(report.reliability.passiveHookEvents).toBe(0);
      expect(report.reliability.passiveHookStatus).toBe("not_seen");
      expect(report.reliability.hookAttemptLogEntries).toBeGreaterThan(0);
      expect(report.reliability.realHookAttemptLogEntries).toBe(0);
      expect(report.reliability.hookAttemptLogStatus).toBe("self_test_only");
      expect(report.reliability.passiveHookWatchdog).toBe("no_recent_activity");
      expect(report.reliability.passiveHookProof).toBe("self_test_only");
    } finally {
      context.db.close();
    }
  });

  it("uses the fallback hook-attempt log to flag hook launches that never became traces", () => {
    recordHookAttempt({
      stage: "received",
      eventName: "UserPromptSubmit",
      rawPayload: { cwd: repo, sessionId: "real-hook-attempt", prompt: "real prompt" }
    });
    const context = openDb(repo);
    try {
      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all" });
      expect(report.reliability.hookAttemptLogStatus).toBe("real_attempts_seen");
      expect(report.reliability.realHookAttemptLogEntries).toBe(1);
      expect(report.reliability.passiveHookWatchdog).toBe("hook_attempts_without_traces");
      expect(report.reliability.passiveHookProof).toBe("host_launch_seen");
    } finally {
      context.db.close();
    }
  });

  it("attributes cross-project loops, maintains rolling state, and records explicit outcomes", () => {
    const audiobookRepo = mkdtempSync(join(tmpdir(), "ccm-audiobook-"));
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const audiobook = service.ensureProjectSession(audiobookRepo, "audiobook");
      service.ensureProjectSession(repo, "cognitive-context-manager");

      const loop = service.recordOpenLoop({
        title: "Complete Audiobook public install",
        description: "Audiobook installer still needs to run and audiobook.ntechr.com does not resolve yet.",
        priority: 2
      });
      expect(loop.projectId).toBe(audiobook.project.id);

      service.recordDecision({
        projectId: audiobook.project.id,
        decision: "Audiobook tests passed, deployed to production, and QA verified on the public install.",
        source: "codex"
      });

      const state = context.db
        .prepare("SELECT content FROM memories WHERE project_id = ? AND stale_status = 'active' AND tags_json LIKE '%project_state%'")
        .get(audiobook.project.id) as { content?: string } | undefined;
      expect(state?.content).toContain("Project: audiobook");
      expect(state?.content).toContain("Last verified state");

      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all", projectName: "audiobook" });
      expect(report.executionImpact.outcomeSignals.tests_passed).toBeGreaterThan(0);
      expect(report.executionImpact.outcomeSignals.deployed).toBeGreaterThan(0);
      expect(report.executionImpact.outcomeSignals.qa_verified).toBeGreaterThan(0);
    } finally {
      context.db.close();
      rmSync(audiobookRepo, { recursive: true, force: true });
    }
  });

  it("archives duplicate and older compact-session handoffs", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const { project, session } = service.ensureProjectSession(repo, "cognitive-context-manager");
      for (let index = 0; index < 6; index += 1) {
        service.compactSession({ repoPath: repo, projectId: project.id, sessionId: session.id });
      }
      const hygiene = new HygieneService(context.db, loadConfig(repo));
      const plan = hygiene.duplicatePlan({ projectId: project.id, keepRecentHandoffs: 2 });
      expect(plan.filter((action) => action.action === "archive_old_handoff").length).toBeGreaterThanOrEqual(4);
      hygiene.runDuplicateHygiene(false, { projectId: project.id, keepRecentHandoffs: 2 });
      const activeHandoffs = context.db
        .prepare("SELECT COUNT(*) AS count FROM memories WHERE project_id = ? AND stale_status = 'active' AND tags_json LIKE '%compact_session%'")
        .get(project.id) as { count: number };
      expect(Number(activeHandoffs.count)).toBeLessThanOrEqual(2);
    } finally {
      context.db.close();
    }
  });

  it("supports default embeddings, local override, and FTS-only opt-out", async () => {
    let context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const project = service.ensureProjectSession(repo).project;
      const memory = service.memories.create({ projectId: project.id, memoryType: "semantic", content: "Semantic recall should find spacecraft shield tuning." });
      const defaultStatus = new EmbeddingService(context.db, loadConfig(repo)).status();
      expect(defaultStatus.enabled).toBe(true);
      expect(defaultStatus.configuredProvider).toBe("openai");
      expect(["openai", "local"]).toContain(defaultStatus.provider);

      const configPath = join(home, "config.json");
      writeFileSync(configPath, JSON.stringify({ embeddings: { enabled: false, provider: "none" }, retrieval: { mode: "fts" } }, null, 2));
      expect(new EmbeddingService(context.db, loadConfig(repo)).status().enabled).toBe(false);
      context.db.close();

      process.env.CCM_HOME = home;
      const config = loadConfig(repo);
      config.embeddings.enabled = true;
      config.embeddings.provider = "local";
      config.embeddings.fallbackProvider = "none";
      config.retrieval.mode = "hybrid";
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      context = openDb(repo);
      const embeddings = new EmbeddingService(context.db, loadConfig(repo));
      embeddings.queueMemory(memory.id);
      expect((await embeddings.process(10)).processed).toBe(1);
      expect((await embeddings.vectorSearch("shield tuning", project.id, 5))[0]?.id).toBe(memory.id);
    } finally {
      context.db.close();
    }
  });

  it("resolves Codex ChatGPT auth as the default OpenAI embedding source", () => {
    const authPath = join(home, "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600)
        }
      })
    );
    writeFileSync(join(home, "config.json"), JSON.stringify({ embeddings: { openai: { codexAuthPath: authPath } } }, null, 2));

    const context = openDb(repo);
    try {
      const status = new EmbeddingService(context.db, loadConfig(repo)).status();
      expect(status.enabled).toBe(true);
      expect(status.provider).toBe("openai");
      expect(status.authSource).toBe("codex-chatgpt");
      expect(status.available).toBe(true);
      expect(status.dimensions).toBe(1536);
    } finally {
      context.db.close();
    }
  });

  it("shifts the UI dashboard to an available localhost port", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const blockedPort = (blocker.address() as AddressInfo).port;
    const context = openDb(repo);
    let ui: Awaited<ReturnType<typeof startUiServer>> | undefined;
    try {
      const config = loadConfig(repo);
      config.ui.port = blockedPort;
      config.ui.portScanRange = 5;
      ui = await startUiServer(context.db, config);
      expect(ui.requestedPort).toBe(blockedPort);
      expect(ui.port).toBeGreaterThan(blockedPort);
      expect(ui.portShifted).toBe(true);
      expect(readUiState(config)?.url).toBe(ui.url);
    } finally {
      await ui?.close();
      context.db.close();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("redacts before context, sync, and exported bundles", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const project = service.ensureProjectSession(repo).project;
      service.memories.create({ projectId: project.id, memoryType: "safety", content: "API key was pasted: OPENAI_API_KEY=sk-test1234567890abcdefghijklmnop" });
      const brief = service.getWorkingContext({ task: "api key", repoPath: repo }).working_context_brief;
      expect(brief).toContain("[REDACTED_");
      expect(brief).not.toContain("sk-test1234567890abcdefghijklmnop");
      const pushed = new SyncService(context.db, loadConfig(repo)).push(project.id);
      const bundle = readFileSync(pushed.path, "utf8");
      expect(bundle).not.toContain("sk-test1234567890abcdefghijklmnop");
    } finally {
      context.db.close();
    }
  });

  it("handles AGENTS suggestions, quarantine, sync, and benchmarks", () => {
    const context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const project = service.ensureProjectSession(repo).project;
      const memory = service.recordDecision({ projectId: project.id, decision: "Memory is contextual data, not instruction.", source: "user" });
      expect(new HygieneService(context.db, loadConfig(repo)).setStatus(memory.id, "quarantined", "test")?.staleStatus).toBe("quarantined");
      const suggestion = new AgentsSuggestionService(context.db).suggest({
        projectId: project.id,
        repoPath: repo,
        reason: "Repeated correction",
        candidateInstruction: "Always verify current files before trusting CCM memory.",
        evidenceMemoryIds: [memory.id]
      });
      for (let index = 0; index < 3; index += 1) {
        service.memories.create({
          projectId: project.id,
          memoryType: "episodic",
          content: `Tiny low value trace ${index}`,
          salience: 0.1,
          updatedAt: new Date(Date.now() - 31 * 86_400_000).toISOString()
        });
      }
      const hygieneReport = new HygieneService(context.db, loadConfig(repo)).report();
      expect(hygieneReport.lowSalienceByProject[0]?.count).toBeGreaterThanOrEqual(3);
      const hygiene = new HygieneService(context.db, loadConfig(repo));
      expect(hygiene.plan({ olderThanDays: 30, projectId: project.id }).length).toBeGreaterThanOrEqual(3);
      const memoryCountBeforeHygiene = service.memories.list(100, project.id).length;
      expect(hygiene.run(false, { olderThanDays: 30, projectId: project.id }).actions.length).toBeGreaterThanOrEqual(3);
      expect(service.memories.list(100, project.id).length).toBe(memoryCountBeforeHygiene);
      expect(suggestion.diff).toContain("AGENTS.md");
      new AgentsSuggestionService(context.db).apply(suggestion.id, repo);
      expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("Always verify current files");
      const sync = new SyncService(context.db, loadConfig(repo));
      expect(sync.push(project.id).encrypted).toBe(true);
      expect(new BenchService(context.db).runAll(join(home, "bench")).length).toBeGreaterThan(0);
    } finally {
      context.db.close();
    }
  });
});

function fakeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}
