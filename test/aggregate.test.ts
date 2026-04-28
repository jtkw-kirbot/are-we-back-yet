import { describe, expect, it } from "vitest";
import { limitText } from "../src/aggregate.js";

describe("aggregation text limits", () => {
  it("trims long adjudication snippets without leaving a dangling citation", () => {
    const input = `${"OpenAI had a much stronger positive signal ".repeat(20)}[E`;
    const output = limitText(input, 120);

    expect(output.length).toBeLessThanOrEqual(120);
    expect(output).not.toMatch(/\[(E\d*)?$/);
    expect(output.endsWith("...")).toBe(true);
  });
});
