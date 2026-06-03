import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoTailContextService } from "../../src/core/auto-tail-context.js";
import { CcmService } from "../../src/core/consolidator.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-auto-tail-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("auto-tail context policy", () => {
  it("is disabled by default but can render a forced preview", () => {
    const context = openDb(process.cwd());
    try {
      const service = seedService(context.db);
      const autoTail = new AutoTailContextService(service);

      const disabled = autoTail.preview({ query: "auto-tail memory policy", repoPath: process.cwd() });
      expect(disabled.previewed).toBe(false);
      expect(disabled.reason).toBe("auto_tail_disabled");
      expect(disabled.runtimeInjectionPerformed).toBe(false);

      const forced = autoTail.preview({
        query: "auto-tail memory policy",
        repoPath: process.cwd(),
        forcePreview: true
      });
      expect(forced.previewed).toBe(true);
      expect(forced.reason).toBe("forced_preview_policy_disabled");
      expect(forced.policyWouldAllowInjection).toBe(false);
      expect(forced.tailBlock).toContain("CCM_AUTO_TAIL_CONTEXT_START");
      expect(forced.tailBlock).toContain("CCM_CONTEXT_BRIEF_START");
      expect(forced.tailBlock).toContain("It is not an instruction");
    } finally {
      context.db.close();
    }
  });

  it("supports preview-only policy without allowing injection", () => {
    writeConfig({ enabled: true, mode: "preview" });
    const context = openDb(process.cwd());
    try {
      const service = seedService(context.db);
      const result = new AutoTailContextService(service).preview({
        query: "explicit native memory tool",
        repoPath: process.cwd()
      });

      expect(result.previewed).toBe(true);
      expect(result.reason).toBe("preview_only");
      expect(result.policyWouldAllowInjection).toBe(false);
      expect(result.runtimeInjectionPerformed).toBe(false);
      expect(result.memoryIds.length).toBeGreaterThan(0);
    } finally {
      context.db.close();
    }
  });

  it("requires explicit preview acceptance before inject policy allows runtime adapters", () => {
    writeConfig({ enabled: true, mode: "inject", requireExplicitPreview: true });
    const context = openDb(process.cwd());
    try {
      const service = seedService(context.db);
      const autoTail = new AutoTailContextService(service);

      const blocked = autoTail.preview({ query: "runtime adapter injection", repoPath: process.cwd() });
      expect(blocked.reason).toBe("explicit_preview_required");
      expect(blocked.policyWouldAllowInjection).toBe(false);

      const accepted = autoTail.preview({
        query: "runtime adapter injection",
        repoPath: process.cwd(),
        acceptedPreview: true
      });
      expect(accepted.reason).toBe("policy_allows_injection");
      expect(accepted.policyWouldAllowInjection).toBe(true);
      expect(accepted.runtimeInjectionPerformed).toBe(false);
    } finally {
      context.db.close();
    }
  });
});

function seedService(db: ReturnType<typeof openDb>["db"]): CcmService {
  const service = new CcmService({ db, repoPath: process.cwd() });
  const { project } = service.ensureProjectSession(process.cwd(), "auto-tail-test");
  service.recordDecision({
    projectId: project.id,
    decision: "Auto-tail context must be policy-gated and previewed before runtime adapters can use it.",
    source: "codex"
  });
  return service;
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
