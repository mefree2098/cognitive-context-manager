import { describe, expect, it } from "vitest";
import { containsSecret, redactSecrets } from "../../src/core/secret-redactor.js";

describe("secret redaction", () => {
  it("redacts fake API keys and credential assignments", () => {
    const result = redactSecrets("OPENAI_API_KEY=sk-test1234567890abcdefghijklmnop and password=supersecretvalue");
    expect(result.text).toContain("[REDACTED_");
    expect(result.text).not.toContain("sk-test1234567890abcdefghijklmnop");
    expect(result.text).not.toContain("supersecretvalue");
    expect(result.redactions.length).toBeGreaterThan(0);
  });

  it("detects private key blocks", () => {
    const text = "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----";
    expect(containsSecret(text)).toBe(true);
    expect(redactSecrets(text).text).toBe("[REDACTED_PRIVATE_KEY]");
  });
});
