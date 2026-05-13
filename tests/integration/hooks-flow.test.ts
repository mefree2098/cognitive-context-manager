import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHook } from "../../src/hooks/hook-entry.js";
import { openDb } from "../../src/storage/db.js";
import { CcmService } from "../../src/core/consolidator.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-hooks-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("hook flow", () => {
  it("captures a long session and produces a resumable brief", async () => {
    await runHook("SessionStart", { cwd: process.cwd(), sessionId: "test-session" });
    await runHook("UserPromptSubmit", {
      cwd: process.cwd(),
      sessionId: "test-session",
      prompt: "Build the plugin and follow up to verify MCP tools before final."
    });
    await runHook("PostToolUse", {
      cwd: process.cwd(),
      sessionId: "test-session",
      command: "npm run test",
      exitCode: 1,
      output: "Tests failed in mcp-tools.test.ts"
    });
    await runHook("PostToolUse", {
      cwd: process.cwd(),
      sessionId: "test-session",
      command: "npm run test",
      exitCode: 0,
      output: "Tests passed",
      changedFiles: ["src/mcp/server.ts"]
    });
    await runHook("Stop", { cwd: process.cwd(), sessionId: "test-session" });

    const briefPath = join(home, "cache", "session-brief.md");
    expect(existsSync(briefPath)).toBe(true);
    expect(readFileSync(briefPath, "utf8")).toContain("Working Context Brief");

    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db });
      expect(service.openLoops.list(undefined, false, 10).length).toBeGreaterThan(0);
      expect(service.memories.search({ query: "Tests passed", includeStale: true, limit: 10 }).length).toBeGreaterThan(0);
    } finally {
      context.db.close();
    }
  });
});
