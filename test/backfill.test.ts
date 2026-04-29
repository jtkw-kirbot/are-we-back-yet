import { describe, expect, it } from "vitest";
import { expandDateRange } from "../src/backfill.js";
import { historicalFetchDelayMs, parseHistoricalFrontPageStoryIds } from "../src/hn.js";

describe("historical HN front page parsing", () => {
  it("extracts first-page story ids in ranked order", () => {
    const html = `
      <tr class="athing submission" id="111"><td>story</td></tr>
      <tr><td><a href="item?id=111">1 comment</a></td></tr>
      <tr class="athing submission" id="222"><td>story</td></tr>
      <tr class="athing submission" id="111"><td>duplicate</td></tr>
      <tr class="athing" id="333"><td>not a submission</td></tr>
    `;

    expect(parseHistoricalFrontPageStoryIds(html)).toEqual([111, 222]);
  });
});

describe("historical HN fetch staggering", () => {
  it("derives a small deterministic delay from the day of month", () => {
    expect(historicalFetchDelayMs("2026-04-10")).toBe(0);
    expect(historicalFetchDelayMs("2026-04-11")).toBe(350);
    expect(historicalFetchDelayMs("2026-04-19")).toBe(3150);
  });
});

describe("backfill date ranges", () => {
  it("expands inclusive UTC date ranges", () => {
    expect(expandDateRange("2026-04-20", "2026-04-22")).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
  });
});
