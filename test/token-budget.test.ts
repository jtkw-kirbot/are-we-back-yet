import { describe, expect, it } from "vitest";
import { estimateTokens, OUTPUT_TOKEN_CAPS, preflightResponseBody, withResponseSafeguards } from "../src/token-budget.js";

describe("token budget preflight", () => {
  it("allows normal row-sized requests with disabled truncation", () => {
    const body = withResponseSafeguards({
      model: "gpt-5.4-mini-2026-03-17",
      input: [{ role: "user", content: "Short Hacker News comment about GPT." }],
    }, OUTPUT_TOKEN_CAPS.rowInitial);

    const result = preflightResponseBody(body, "gpt-5.4-mini-2026-03-17", OUTPUT_TOKEN_CAPS.rowInitial);

    expect(body.truncation).toBe("disabled");
    expect(result.ok).toBe(true);
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
  });

  it("rejects requests that exceed the published context window estimate", () => {
    const hugeText = "x ".repeat(1_000_000);
    const body = withResponseSafeguards({
      model: "gpt-5.4-mini-2026-03-17",
      input: [{ role: "user", content: hugeText }],
    }, OUTPUT_TOKEN_CAPS.rowInitial);

    const result = preflightResponseBody(body, "gpt-5.4-mini-2026-03-17", OUTPUT_TOKEN_CAPS.rowInitial);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("oversize_input_preflight");
  });

  it("uses token estimates rather than character counts alone", () => {
    expect(estimateTokens("hello world")).toBeLessThan("hello world".length);
  });
});
