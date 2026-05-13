import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markContradictedMemories } from "../../src/core/stale-resolver.js";
import { openDb } from "../../src/storage/db.js";
import { MemoriesRepo } from "../../src/storage/repositories/memories-repo.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-stale-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("stale resolver", () => {
  it("marks contradicted memories as superseded", () => {
    const context = openDb(process.cwd());
    try {
      const repo = new MemoriesRepo(context.db);
      const oldMemory = repo.create({
        memoryType: "semantic",
        content: "SettingsView close button works.",
        entities: ["SettingsView"],
        salience: 0.7
      });
      const newMemory = repo.create({
        memoryType: "salience",
        content: "User reports SettingsView close button does not dismiss.",
        entities: ["SettingsView"],
        salience: 0.9
      });
      expect(markContradictedMemories(repo, newMemory, [oldMemory])).toEqual([oldMemory.id]);
      expect(repo.get(oldMemory.id)?.staleStatus).toBe("superseded");
    } finally {
      context.db.close();
    }
  });
});
