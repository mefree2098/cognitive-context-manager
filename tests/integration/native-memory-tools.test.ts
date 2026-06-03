import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import {
  memoryDelete,
  memoryList,
  memorySave,
  memorySearch,
  memoryUpdate
} from "../../src/mcp/tools/native-memory.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-native-memory-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("native-style memory MCP tools", () => {
  it("saves, searches, lists, updates, and deletes through CCM memory semantics", () => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const { project } = service.ensureProjectSession(process.cwd(), "native-memory-tools");

      const saved = memorySave(service, {
        projectId: project.id,
        content: "Native memory tools should stay explicit before auto-tail injection is enabled.",
        memoryType: "procedural",
        tags: ["headroom-parity"],
        salience: 0.8,
        confidence: 0.85
      });

      expect(saved.memory.id).toMatch(/^memory_/);
      expect(saved.memory.tags).toContain("native-memory-tool");

      const searched = memorySearch(service, {
        query: "auto-tail injection",
        projectId: project.id,
        limit: 10,
        includeStale: false
      });
      expect(searched.results.map((memory) => memory.id)).toContain(saved.memory.id);

      const listed = memoryList(service, { projectId: project.id, limit: 10, includeStale: false });
      expect(listed.results.map((memory) => memory.id)).toContain(saved.memory.id);

      const updated = memoryUpdate(service, {
        id: saved.memory.id,
        content: "Native memory tools stay explicit; auto-tail remains policy gated.",
        tags: ["headroom-parity", "policy-gate"]
      });
      expect(updated.ok).toBe(true);
      expect(updated.memory?.supersedes).toContain(saved.memory.id);
      expect(service.memories.get(saved.memory.id)?.staleStatus).toBe("superseded");

      const deleted = memoryDelete(service, { id: updated.memory!.id, hardDelete: false });
      expect(deleted.ok).toBe(true);
      expect(service.memories.get(updated.memory!.id)?.staleStatus).toBe("forgotten");
    } finally {
      context.db.close();
    }
  });
});
