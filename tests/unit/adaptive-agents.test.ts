import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config.js";
import { AdaptiveAgentGuidanceService } from "../../src/core/adaptive-agents.js";
import { openDb } from "../../src/storage/db.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccm-adaptive-"));
  process.env.CCM_HOME = home;
});

afterEach(() => {
  delete process.env.CCM_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("adaptive agent guidance", () => {
  it("creates managed guidance files and previews under budget", () => {
    const context = openDb(process.cwd());
    try {
      const service = new AdaptiveAgentGuidanceService(context.db, loadConfig(process.cwd()));
      service.ensureFiles();
      expect(readFileSync(service.guidancePath(), "utf8")).toContain("CCM Adaptive Agent Guidance");
      expect(service.preview(120).tokenCount).toBeLessThanOrEqual(130);
    } finally {
      context.db.close();
    }
  });

  it("classifies repeated placeholder corrections and applies a deduplicated rule", () => {
    const context = openDb(process.cwd());
    try {
      const service = new AdaptiveAgentGuidanceService(context.db, loadConfig(process.cwd()));
      const first = service.observeText("Do not use placeholders in generated code.", ["evt_1"]);
      expect(first?.status).toBe("pending");
      const second = service.observeText("Do not use placeholders in generated code.", ["evt_2"]);
      expect(second?.status).toBe("applied");
      const guidance = readFileSync(service.guidancePath(), "utf8");
      expect(guidance).toContain("complete executable code");
      expect((guidance.match(/complete executable code/g) ?? []).length).toBe(1);
    } finally {
      context.db.close();
    }
  });

  it("rejects one-off preferences and secret-bearing patches", () => {
    const context = openDb(process.cwd());
    try {
      const service = new AdaptiveAgentGuidanceService(context.db, loadConfig(process.cwd()));
      expect(service.previewPatch("For this one task, use Python.")).toBeUndefined();
      const rejected = service.proposePatch({ rule: "Store API_TOKEN=abc123 in the adaptive guidance.", reason: "bad" });
      expect(rejected.status).toBe("rejected");
      expect(readFileSync(service.guidancePath(), "utf8")).not.toContain("API_TOKEN");
    } finally {
      context.db.close();
    }
  });

  it("applies explicit patches and rolls back to the prior hash", () => {
    const context = openDb(process.cwd());
    try {
      const service = new AdaptiveAgentGuidanceService(context.db, loadConfig(process.cwd()));
      const before = service.status().currentHash;
      const pending = service.proposePatch({
        rule: "When repo AGENTS.md conflicts with CCM memory, follow repo AGENTS.md.",
        reason: "test",
        requiresReview: true
      });
      const applied = service.applyPatch(pending.id);
      expect(applied.status).toBe("applied");
      expect(service.status().currentHash).not.toBe(before);
      const rollback = service.rollback(before);
      expect(rollback.newHash).toBe(before);
      expect(service.status().currentHash).toBe(before);
      expect(service.history().join("\n")).toContain("rolled_back");
    } finally {
      context.db.close();
    }
  });
});
