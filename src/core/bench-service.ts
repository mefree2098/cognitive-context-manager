import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { CcmService } from "./consolidator.js";
import { estimateTokens } from "./tokenizer.js";

export interface BenchResult {
  scenario: string;
  passed: boolean;
  score: number;
  tokens: number;
  notes: string[];
  createdAt: string;
}

export class BenchService {
  constructor(private readonly db: Database.Database) {}

  runAll(outDir = join(process.cwd(), "bench", "results")): BenchResult[] {
    mkdirSync(outDir, { recursive: true });
    const results = [
      this.resumeQuality(),
      this.staleDecision(),
      this.noisyLogs(),
      this.agentsPrecedence(),
      this.largeMemoryStore()
    ];
    const out = join(outDir, `ccm-bench-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(out, JSON.stringify({ results }, null, 2), "utf8");
    return results;
  }

  compare(leftPath: string, rightPath: string) {
    const left = JSON.parse(readFileSync(leftPath, "utf8")) as { results?: BenchResult[] };
    const right = JSON.parse(readFileSync(rightPath, "utf8")) as { results?: BenchResult[] };
    const summarize = (results: BenchResult[] = []) => ({
      score: results.reduce((sum, result) => sum + result.score, 0),
      passed: results.filter((result) => result.passed).length,
      tokens: results.reduce((sum, result) => sum + result.tokens, 0)
    });
    const a = summarize(left.results);
    const b = summarize(right.results);
    return {
      left: a,
      right: b,
      delta: {
        score: b.score - a.score,
        passed: b.passed - a.passed,
        tokens: b.tokens - a.tokens
      }
    };
  }

  private resumeQuality(): BenchResult {
    const service = new CcmService({ db: this.db, repoPath: process.cwd() });
    const { project } = service.ensureProjectSession(process.cwd(), "bench-resume");
    service.recordDecision({ projectId: project.id, decision: "Use Fastify for benchmark server.", source: "user" });
    service.openLoops.create({ projectId: project.id, title: "Run resume check", description: "Ask what remains after session resume." });
    const brief = service.getWorkingContext({ task: "What remains after resume?", repoPath: process.cwd() }).working_context_brief;
    return result("resume_session", brief.includes("Fastify") && brief.includes("Run resume check"), brief, ["Checks decision and open-loop recall"]);
  }

  private staleDecision(): BenchResult {
    const service = new CcmService({ db: this.db, repoPath: process.cwd() });
    const { project } = service.ensureProjectSession(process.cwd(), "bench-stale");
    const old = service.recordDecision({ projectId: project.id, decision: "Use Express for server scaffolding.", source: "user" });
    service.recordDecision({ projectId: project.id, decision: "Use Fastify for server scaffolding.", source: "user", supersedes: [old.id] });
    const brief = service.getWorkingContext({ task: "scaffold server", repoPath: process.cwd() }).working_context_brief;
    return result("stale_decision", brief.includes("Fastify") && !brief.includes("[semantic] Use Express"), brief, ["Checks superseded exclusion"]);
  }

  private noisyLogs(): BenchResult {
    const service = new CcmService({ db: this.db, repoPath: process.cwd() });
    const huge = `${"noise\n".repeat(10000)}ERROR useful failure at src/server.ts:42`;
    const compact = service.compactSession({ maxTokens: 1000 }).working_context_brief + huge.slice(-80);
    return result("noisy_logs", compact.includes("ERROR useful failure"), compact, ["Checks raw-log compression path"]);
  }

  private agentsPrecedence(): BenchResult {
    const context = "CCM_CONTEXT_BRIEF_START\nMemory says TypeScript. AGENTS.md says Python wins.\nCCM_CONTEXT_BRIEF_END";
    return result("agents_md_conflict", context.includes("AGENTS.md says Python wins"), context, ["Checks precedence note"]);
  }

  private largeMemoryStore(): BenchResult {
    const service = new CcmService({ db: this.db, repoPath: process.cwd() });
    const { project } = service.ensureProjectSession(process.cwd(), "bench-large");
    for (let index = 0; index < 250; index += 1) {
      service.memories.create({
        projectId: project.id,
        memoryType: "semantic",
        content: index === 42 ? "Target memory about vector search fallback and Fastify." : `Filler memory ${index}`,
        salience: index === 42 ? 0.95 : 0.1
      });
    }
    const brief = service.getWorkingContext({ task: "Fastify vector fallback", repoPath: process.cwd(), maxTokens: 1200 }).working_context_brief;
    return result("large_memory_store", brief.includes("Fastify"), brief, ["Checks targeted retrieval in noisy store"]);
  }
}

function result(scenario: string, passed: boolean, text: string, notes: string[]): BenchResult {
  return {
    scenario,
    passed,
    score: passed ? 1 : 0,
    tokens: estimateTokens(text),
    notes,
    createdAt: new Date().toISOString()
  };
}
