import { describe, expect, it } from "vitest";
import { scoreSalience, scoreSignals } from "../../src/core/salience-scorer.js";

describe("salience scoring", () => {
  it("scores explicit durable user corrections highly", () => {
    const score = scoreSalience({ text: "From now on, never skip live verification. This is important." });
    expect(score).toBeGreaterThan(0.55);
  });

  it("adds weight for failures and safety signals", () => {
    expect(scoreSignals(["failure", "safety"], "rm -rf failed with permission denied")).toBeGreaterThan(0.6);
  });
});
