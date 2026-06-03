import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CcmService } from "../../src/core/consolidator.js";
import { runHook } from "../../src/hooks/hook-entry.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-auto-tail-hook-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("auto-tail UserPromptSubmit hook adapter", () => {
  it("emits additional context only when inject policy allows it", async () => {
    writeConfig({ enabled: true, mode: "inject", requireExplicitPreview: false });
    seedMemory();

    const result = await runHook("UserPromptSubmit", {
      cwd: process.cwd(),
      sessionId: "auto-tail-hook",
      prompt: "Continue the auto-tail runtime adapter work."
    });

    expect(result.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(result.hookSpecificOutput?.additionalContext).toContain("CCM_AUTO_TAIL_CONTEXT_START");
    expect(result.hookSpecificOutput?.additionalContext).toContain("CCM_CONTEXT_BRIEF_START");
    expect(result.hookSpecificOutput?.ccmAutoTail).toMatchObject({ reason: "policy_allows_injection" });
  });

  it("does not emit additional context when explicit preview acceptance is required", async () => {
    writeConfig({ enabled: true, mode: "inject", requireExplicitPreview: true });
    seedMemory();

    const blocked = await runHook("UserPromptSubmit", {
      cwd: process.cwd(),
      sessionId: "auto-tail-hook",
      prompt: "Continue the auto-tail runtime adapter work."
    });
    expect(blocked.hookSpecificOutput).toBeUndefined();

    const accepted = await runHook("UserPromptSubmit", {
      cwd: process.cwd(),
      sessionId: "auto-tail-hook",
      prompt: "Continue the auto-tail runtime adapter work.",
      ccmAutoTailAcceptedPreview: true
    });
    expect(accepted.hookSpecificOutput?.additionalContext).toContain("CCM_AUTO_TAIL_CONTEXT_START");
  });
});

function seedMemory(): void {
  const context = openDb(process.cwd());
  try {
    const service = new CcmService({ db: context.db, repoPath: process.cwd() });
    const { project } = service.ensureProjectSession(process.cwd());
    service.recordDecision({
      projectId: project.id,
      decision: "Runtime auto-tail adapters must use policy-gated additional context instead of mutating instructions.",
      source: "codex"
    });
  } finally {
    context.db.close();
  }
}

function writeConfig(autoTail: Record<string, unknown>): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      memoryBridge: {
        autoTail: {
          maxTokens: 700,
          includeOpenLoops: true,
          includeProcedural: true,
          ...autoTail
        }
      }
    })
  );
}
