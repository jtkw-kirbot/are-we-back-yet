import { describe, expect, it } from "vitest";
import { DailyResultSchema, RawDaySchema, TitleAnalysisSchema } from "../src/types.js";

describe("daily result schema", () => {
  it("requires all four canonical entities and evidence-backed snippets", () => {
    const entity = {
      score: 0.1,
      rawWeightedSentiment: 0.2,
      mentionCount: 3,
      positiveCount: 2,
      neutralCount: 1,
      negativeCount: 0,
      confidence: 0.8,
      judgementSnippet: "Positive due to titles [E1].",
      evidenceIds: ["E1"],
    };

    const parsed = DailyResultSchema.parse({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_title_snapshot",
      winner: "openai",
      dailyJudgementSnippet: "OpenAI led the day [E1].",
      winnerExplanation: "OpenAI had the strongest positive signal [E1].",
      lowConfidence: true,
      closeCall: false,
      margin: 0.12,
      models: {
        titleAnalysis: "gpt-5.4-mini-2026-03-17",
      },
      methodVersion: {
        titleAnalysisPrompt: "title-analysis-v1",
        aggregation: "title-winner-v1",
        schema: "daily-v1",
      },
      entities: {
        openai: entity,
        anthropic: { ...entity, score: 0.05 },
        google_gemini: { ...entity, score: -0.01 },
        microsoft_copilot: { ...entity, score: 0.02 },
      },
      evidence: [{
        id: "E1",
        entity: "openai",
        hnItemId: 123,
        url: "https://news.ycombinator.com/item?id=123",
        role: "positive_driver",
        summary: "Representative positive discussion.",
      }],
    });

    expect(parsed.entities.microsoft_copilot.score).toBe(0.02);
  });
});

describe("raw day schema", () => {
  it("accepts front-page HN items with omitted story urls", () => {
    const parsed = RawDaySchema.parse({
      date: "2026-04-28",
      fetchedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_title_snapshot",
      source: "firebase",
      items: [{
        id: 123,
        type: "story",
        title: "HN item 123",
        rank: 1,
        depth: 0,
        storyId: 123,
        storyTitle: "HN item 123",
        sourceUrl: "https://news.ycombinator.com/item?id=123",
      }],
    });

    expect(parsed.items[0]?.storyUrl).toBeUndefined();
  });

  it("accepts historical front-page snapshots", () => {
    const parsed = RawDaySchema.parse({
      date: "2026-04-20",
      fetchedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "historical_frontpage_title_snapshot",
      source: "hn_front_html_firebase",
      items: [],
    });

    expect(parsed.samplingMethod).toBe("historical_frontpage_title_snapshot");
  });
});

describe("title analysis schema", () => {
  it("trims overlong title-level judgement snippets from model output", () => {
    const parsed = TitleAnalysisSchema.parse({
      itemId: 123,
      target: "openai",
      sentiment: 1,
      confidence: 0.8,
      relevance: true,
      evidenceSummary: "Positive title.",
      judgementSnippet: "x".repeat(400),
    });

    expect(parsed.judgementSnippet).toHaveLength(320);
    expect(parsed.judgementSnippet.endsWith("...")).toBe(true);
  });
});
