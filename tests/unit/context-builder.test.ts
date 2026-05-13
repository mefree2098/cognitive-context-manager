import { describe, expect, it } from "vitest";
import { buildWorkingContext, renderWorkingContextBrief } from "../../src/core/context-builder.js";
import { estimateTokens } from "../../src/core/tokenizer.js";

describe("context builder", () => {
  it("renders a brief under the requested token budget", () => {
    const brief = buildWorkingContext({
      currentTask: "Fix the long-running context flow",
      maxTokens: 120,
      memories: Array.from({ length: 20 }, (_, index) => ({
        id: `memory_${index}`,
        memoryType: "semantic" as const,
        content: `Important fact ${index} `.repeat(20),
        summary: `Important fact ${index}`,
        entities: [],
        tags: [],
        retrievalCues: [],
        salience: 0.9,
        confidence: 0.8,
        sourceRefs: [],
        supersedes: [],
        staleStatus: "active" as const,
        decayPolicy: "normal" as const,
        validFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      openLoops: [],
      artifacts: []
    });
    const rendered = renderWorkingContextBrief(brief, 120);
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(130);
    expect(rendered).toContain("# Working Context Brief");
  });
});
