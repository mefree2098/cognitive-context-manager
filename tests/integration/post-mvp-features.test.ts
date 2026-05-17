import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";
import { AgentsSuggestionService } from "../../src/core/agents-suggestions.js";
import { BenchService } from "../../src/core/bench-service.js";
import { backupDatabase, schemaStatus, verifyDatabase } from "../../src/core/db-admin.js";
import { EmbeddingService } from "../../src/core/embedding-provider.js";
import { EffectivenessReportService } from "../../src/core/effectiveness-report.js";
import { HygieneService } from "../../src/core/hygiene.js";
import { SyncService } from "../../src/core/sync-service.js";
import { CcmService } from "../../src/core/consolidator.js";
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
      service.getWorkingContext({ task: "resume manga from page_013.png", repoPath: repo, projectName: "manga" });

      const report = new EffectivenessReportService(context.db, loadConfig(repo)).report({ since: "all", projectName: "manga" });
      expect(report.resilience.failureSignals).toBeGreaterThan(0);
      expect(report.resilience.resumeSignals).toBeGreaterThan(0);
      expect(report.resilience.checkpointSignals).toBeGreaterThan(0);
      expect(report.resilience.lastCheckpoint).toBe("page_013.png");
      expect(report.summary.contextBriefsGenerated).toBeGreaterThan(0);
      expect(new EffectivenessReportService(context.db, loadConfig(repo)).renderMarkdown(report)).toContain("Long-Running Task Resilience");
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

  it("supports opt-in local embeddings and FTS fallback when disabled", async () => {
    let context = openDb(repo);
    try {
      const service = new CcmService({ db: context.db, repoPath: repo });
      const project = service.ensureProjectSession(repo).project;
      const memory = service.memories.create({ projectId: project.id, memoryType: "semantic", content: "Semantic recall should find spacecraft shield tuning." });
      expect(new EmbeddingService(context.db, loadConfig(repo)).status().enabled).toBe(false);
      context.db.close();

      process.env.CCM_HOME = home;
      const configPath = join(home, "config.json");
      const config = loadConfig(repo);
      config.embeddings.enabled = true;
      config.embeddings.provider = "local";
      config.retrieval.mode = "hybrid";
      const { writeFileSync } = await import("node:fs");
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
