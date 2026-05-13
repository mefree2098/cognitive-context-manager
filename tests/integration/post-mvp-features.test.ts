import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";
import { AgentsSuggestionService } from "../../src/core/agents-suggestions.js";
import { BenchService } from "../../src/core/bench-service.js";
import { backupDatabase, schemaStatus, verifyDatabase } from "../../src/core/db-admin.js";
import { EmbeddingService } from "../../src/core/embedding-provider.js";
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
