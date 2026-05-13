import { describe, expect, it } from "vitest";
import { detectEventBoundary, normalizeHookPayload } from "../../src/core/event-segmenter.js";

describe("event segmenter", () => {
  it("classifies corrections as preferences when durable language appears", () => {
    const payload = normalizeHookPayload("UserPromptSubmit", {
      prompt: "From now on, don't stop after local patches. Continue through verification."
    });
    const boundary = detectEventBoundary(payload);
    expect(boundary.isBoundary).toBe(true);
    expect(boundary.signals).toContain("preference");
    expect(boundary.eventType).toBe("preference");
  });

  it("classifies failed test commands as test results before generic failures", () => {
    const payload = normalizeHookPayload("PostToolUse", {
      command: "npm run test",
      exitCode: 1,
      output: "Tests failed"
    });
    const boundary = detectEventBoundary(payload);
    expect(boundary.signals).toContain("test_result");
    expect(boundary.eventType).toBe("failure");
  });
});
