import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-storage-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("storage and retrieval", () => {
  it("stores decisions and retrieves them through working context", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const { project } = service.ensureProjectSession(process.cwd(), "test-project");
      const memory = service.recordDecision({
        projectId: project.id,
        decision: "Use FTS retrieval for MVP.",
        rationale: "No cloud dependency is allowed.",
        source: "user"
      });
      const result = service.getWorkingContext({ task: "retrieval MVP", repoPath: process.cwd(), maxTokens: 1000 });
      expect(result.memory_ids).toContain(memory.id);
      expect(result.working_context_brief).toContain("Use FTS retrieval for MVP");
    } finally {
      context.db.close();
    }
  });
});
