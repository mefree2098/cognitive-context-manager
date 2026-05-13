import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-golden-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("golden context behavior", () => {
  it("includes Fastify, excludes superseded Express, and excludes unrelated Python", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const project = service.ensureProjectSession(process.cwd(), "golden").project;
      const express = service.recordDecision({ projectId: project.id, decision: "Use Express for server scaffolding.", source: "user" });
      service.recordDecision({ projectId: project.id, decision: "Use Fastify for server scaffolding.", source: "user", supersedes: [express.id] });
      service.memories.create({ memoryType: "procedural", content: "Use Python for unrelated data scripts.", salience: 0.9 });
      const brief = service.getWorkingContext({ task: "scaffold server", repoPath: process.cwd(), maxTokens: 1400 }).working_context_brief;
      expect(brief).toContain("Fastify");
      expect(brief).not.toContain("[semantic] Use Express");
      expect(brief).not.toContain("Use Python for unrelated data scripts");
    } finally {
      context.db.close();
    }
  });
});
