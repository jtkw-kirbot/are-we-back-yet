import { describe, expect, it } from "vitest";
import { analysisBackend, expandDateRange } from "../src/backfill.js";
import { parseHistoricalFrontPageStoryIds } from "../src/hn.js";

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

describe("backfill date ranges", () => {
  it("expands inclusive UTC date ranges", () => {
    expect(expandDateRange("2026-04-20", "2026-04-22")).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
  });

  it("rejects unsupported backends", () => {
    expect(() => analysisBackend("batch")).toThrow("Unsupported analysis backend");
  });
});
