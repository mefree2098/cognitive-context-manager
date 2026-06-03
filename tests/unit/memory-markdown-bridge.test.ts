import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import { MemoryMarkdownBridgeService } from "../../src/core/memory-markdown-bridge.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-memory-bridge-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("memory markdown bridge", () => {
  it("exports active memories in a round-trippable markdown format", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const { project } = service.ensureProjectSession(process.cwd(), "bridge-export");
      service.recordDecision({
        projectId: project.id,
        decision: "Prefer tool-mode memory retrieval before trying invisible auto-injection.",
        rationale: "It keeps recalled context explicit and auditable.",
        source: "codex"
      });

      const markdown = new MemoryMarkdownBridgeService(service).exportMarkdown({ projectId: project.id });

      expect(markdown).toContain("# CCM Memory Export");
      expect(markdown).toContain("<!-- ccm-memory ");
      expect(markdown).toContain("[semantic]");
      expect(markdown).toContain("Prefer tool-mode memory retrieval");
    } finally {
      context.db.close();
    }
  });

  it("imports generic markdown sections as typed CCM memories", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const { project } = service.ensureProjectSession(process.cwd(), "bridge-import");
      const bridge = new MemoryMarkdownBridgeService(service);

      const result = bridge.importMarkdown(
        [
          "# Native Memory Tool",
          "Expose recall as an explicit tool before enabling automatic injection.",
          "",
          "## Markdown Bridge",
          "Import and export sectioned markdown while preserving CCM redaction."
        ].join("\n"),
        { projectId: project.id, tag: ["headroom-bridge"], defaultMemoryType: "procedural" }
      );

      expect(result.imported).toBe(2);
      expect(result.memoryIds).toHaveLength(2);

      const found = service.searchMemories({
        query: "automatic injection",
        projectId: project.id,
        includeStale: false,
        limit: 5
      });
      expect(found[0]?.memoryType).toBe("procedural");
      expect(found[0]?.tags).toContain("markdown-bridge");
      expect(found[0]?.tags).toContain("headroom-bridge");
    } finally {
      context.db.close();
    }
  });

  it("round-trips CCM markdown metadata back into memories", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const { project } = service.ensureProjectSession(process.cwd(), "bridge-round-trip");
      service.memories.create({
        projectId: project.id,
        memoryType: "safety",
        content: "Auto-tail injection must remain policy-gated and clearly labeled.",
        summary: "Policy gate auto-tail injection",
        tags: ["runtime-injection"],
        salience: 0.9,
        confidence: 0.85
      });

      const bridge = new MemoryMarkdownBridgeService(service);
      const markdown = bridge.exportMarkdown({ projectId: project.id });
      const result = bridge.importMarkdown(markdown, { projectId: project.id, dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.candidates[0]?.memoryType).toBe("safety");
      expect(result.candidates[0]?.tags).toContain("runtime-injection");
      expect(result.candidates[0]?.salience).toBe(0.9);
    } finally {
      context.db.close();
    }
  });
});
