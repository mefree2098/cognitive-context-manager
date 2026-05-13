import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import { getProjectState } from "../../src/mcp/tools/get-project-state.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-project-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("project state", () => {
  it("reports decisions, preferences, open loops, and artifacts", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const { project } = service.ensureProjectSession(process.cwd());
      service.recordDecision({ projectId: project.id, decision: "Prefer concise briefs.", source: "user" });
      service.recordPreference({ preference: "Keep memory as recall, not truth.", scope: "project", durability: "long_term", source: "user" });
      service.openLoops.create({ projectId: project.id, title: "Verify doctor", description: "Run ccm doctor before final." });
      service.artifacts.upsert({ projectId: project.id, path: "src/mcp/server.ts", summary: "MCP entrypoint", status: "tracked" });

      const state = getProjectState(service, { projectId: project.id });
      expect(state.project?.id).toBe(project.id);
      expect(state.decisions.length).toBeGreaterThan(0);
      expect(state.procedural.length).toBeGreaterThan(0);
      expect(state.open_loops.length).toBe(1);
    } finally {
      context.db.close();
    }
  });
});
