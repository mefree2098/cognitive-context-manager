import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import { runHook } from "../../src/hooks/hook-entry.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-adaptive-hooks-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("adaptive guidance hooks and context", () => {
  it("learns repeated corrections through hooks and injects compact adaptive guidance", async () => {
    await runHook("SessionStart", { cwd: process.cwd(), sessionId: "adaptive-hooks" });
    await runHook("UserPromptSubmit", {
      cwd: process.cwd(),
      sessionId: "adaptive-hooks",
      prompt: "Do not use placeholders in generated code."
    });
    await runHook("UserPromptSubmit", {
      cwd: process.cwd(),
      sessionId: "adaptive-hooks",
      prompt: "Do not use placeholders in generated code."
    });
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const brief = service.getWorkingContext({ task: "coding handoff", repoPath: process.cwd(), maxTokens: 1400 }).working_context_brief;
      expect(brief).toContain("CCM adaptive guidance");
      expect(brief).toContain("complete executable code");
      expect(brief).toContain("AGENTS.md");
    } finally {
      context.db.close();
    }
  });
});
