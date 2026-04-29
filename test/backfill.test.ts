import { describe, expect, it } from "vitest";
import { expandDateRange, githubRetryDelayMs, isRetryableGithubErrorText } from "../src/backfill.js";
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

describe("backfill GitHub publish retries", () => {
  it("detects transient GitHub transport failures", () => {
    expect(isRetryableGithubErrorText(
      "fatal: unable to access 'https://github.com/jtkw-kirbot/hn-ai-sentiment.git/': Failed to connect to github.com port 443 after 134884 ms: Could not connect to server",
    )).toBe(true);
    expect(isRetryableGithubErrorText("Post https://api.github.com/graphql: dial tcp: i/o timeout")).toBe(true);
    expect(isRetryableGithubErrorText("HTTP 503 Service Unavailable")).toBe(true);
  });

  it("does not retry permanent git failures", () => {
    expect(isRetryableGithubErrorText("CONFLICT (content): Merge conflict in data/index.json")).toBe(false);
    expect(isRetryableGithubErrorText("remote: Invalid username or password. fatal: Authentication failed")).toBe(false);
  });

  it("backs off retries with a cap", () => {
    expect(githubRetryDelayMs(0)).toBe(3_000);
    expect(githubRetryDelayMs(1)).toBe(6_000);
    expect(githubRetryDelayMs(10)).toBe(30_000);
  });
});
