import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import { getOpenLoops } from "../../src/mcp/tools/get-open-loops.js";
import { getWorkingContext } from "../../src/mcp/tools/get-working-context.js";
import { recordDecision } from "../../src/mcp/tools/record-decision.js";
import { searchMemories } from "../../src/mcp/tools/search-memories.js";
import { compactSession } from "../../src/mcp/tools/compact-session.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-mcp-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("MCP tool wrappers", () => {
  it("returns stable JSON-shaped results", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const project = service.ensureProjectSession(process.cwd()).project;
      const decision = recordDecision(service, {
        projectId: project.id,
        decision: "Use local SQLite storage.",
        source: "user",
        supersedes: []
      });
      expect(decision.memory.id).toMatch(/^memory_/);
      expect(searchMemories(service, { query: "SQLite", projectId: project.id, includeStale: false, limit: 10 }).results.length).toBe(1);
      expect(getOpenLoops(service, { projectId: project.id, includeClosed: false, limit: 10 }).open_loops).toEqual([]);
      expect(getWorkingContext(service, { task: "SQLite storage", repoPath: process.cwd(), maxTokens: 1200, includeArtifacts: true, includeOpenLoops: true, includeProcedural: true }).working_context_brief).toContain("SQLite");
      expect(compactSession(service, { projectId: project.id, maxTokens: 1200 }).working_context_brief).toContain("Session Handoff");
    } finally {
      context.db.close();
    }
  });
});
