import { describe, expect, it } from "vitest";
import { DailyResultSchema, RawDaySchema } from "../src/types.js";

const annotation = {
  target: "openai",
  referenceBasis: "explicit_alias",
  stance: 1,
  stanceLabel: "positive",
  relevance: "central",
  topic: "release",
  confidence: "high",
  attributionConfidence: "high",
  rationale: "The title directly discusses OpenAI in a positive release context.",
};

const evidence = {
  id: "E1",
  storyId: 123,
  hnUrl: "https://news.ycombinator.com/item?id=123",
  sourceType: "title",
  excerpt: "OpenAI launches a useful thing",
  annotations: [annotation],
};

const ranking = {
  target: "openai",
  bucket: "positive",
  direction: "positive",
  support: "low",
  confidence: "high",
  rawMean: 1,
  adjustedMean: 0.5,
  effectiveSupport: 2,
  evidenceBalance: {
    positive: 1,
    neutral: 0,
    negative: 0,
  },
  displayRank: 1,
  tiedWith: [],
  rankNote: "low_support",
  evidenceIds: ["E1"],
  summary: "OpenAI had a positive release signal [E1].",
};

describe("daily result schema", () => {
  it("accepts the auditable ranked daily result shape", () => {
    const parsed = DailyResultSchema.parse({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_day_query_story_comment_snapshot",
      rankingDirection: "most_negative_to_most_positive",
      headlineSummary: "OpenAI had the clearest positive signal [E1].",
      primarySignalTarget: "openai",
      primarySignalTargets: ["openai"],
      primarySignalTie: false,
      primarySignalDirection: "positive",
      hasLowSupportLeader: true,
      ranking: [ranking],
      unmentioned: ["anthropic", "google_gemini", "microsoft_copilot"],
      evidence: [evidence],
      models: {
        evidenceDetection: "gpt-5.4-2026-03-05",
        dailySummary: "gpt-5.4-mini-2026-03-17",
      },
      methodVersion: {
        evidenceDetectionPrompt: "evidence-annotation-v1",
        dailySummaryPrompt: "cited-summary-v1",
        aggregation: "deterministic-auditable-v1",
        schema: "daily-v4",
      },
    });

    expect(parsed.ranking[0]?.target).toBe("openai");
  });

  it("rejects ranked targets without matching evidence", () => {
    expect(() => DailyResultSchema.parse({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_day_query_story_comment_snapshot",
      rankingDirection: "most_negative_to_most_positive",
      headlineSummary: "Bad evidence.",
      primarySignalTarget: "openai",
      primarySignalTargets: ["openai"],
      primarySignalTie: false,
      primarySignalDirection: "positive",
      hasLowSupportLeader: true,
      ranking: [{ ...ranking, evidenceIds: [] }],
      unmentioned: ["anthropic", "google_gemini", "microsoft_copilot"],
      evidence: [evidence],
      models: {},
      methodVersion: {},
    })).toThrow();
  });
});

describe("raw day schema", () => {
  it("accepts front?day snapshots with omitted story urls", () => {
    const parsed = RawDaySchema.parse({
      date: "2026-04-28",
      fetchedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_day_query_story_comment_snapshot",
      source: "hn_front_day_query_firebase",
      items: [{
        id: 123,
        type: "story",
        title: "HN item 123",
        rank: 1,
        depth: 0,
        storyId: 123,
        storyTitle: "HN item 123",
        sourceUrl: "https://news.ycombinator.com/item?id=123",
        topComments: [{
          id: 456,
          text: "Interesting context from HN.",
          sourceUrl: "https://news.ycombinator.com/item?id=456",
        }],
      }],
    });

    expect(parsed.items[0]?.storyUrl).toBeUndefined();
    expect(parsed.items[0]?.topComments).toHaveLength(1);
  });
});
