import { describe, expect, it } from "vitest";
import { DailyResultSchema, RawDaySchema, SentimentResultSchema } from "../src/types.js";

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
      judgementSnippet: "Positive due to comments [E1].",
      evidenceIds: ["E1"],
    };

    const parsed = DailyResultSchema.parse({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_snapshot",
      winner: "openai",
      dailyJudgementSnippet: "OpenAI led the day [E1].",
      winnerExplanation: "OpenAI had the strongest positive signal [E1].",
      lowConfidence: true,
      closeCall: false,
      margin: 0.12,
      models: {
        entity: "gpt-5.4-mini-2026-03-17",
        sentiment: "gpt-5.4-mini-2026-03-17",
        adjudication: "gpt-5.5-2026-04-23",
      },
      methodVersion: {
        entityPrompt: "entity-v1",
        sentimentPrompt: "sentiment-v1",
        adjudicationPrompt: "adjudication-v1",
        aggregation: "winner-v1",
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
  it("accepts backfilled HN items with omitted story urls", () => {
    const parsed = RawDaySchema.parse({
      date: "2026-04-01",
      fetchedAt: "2026-04-02T04:00:00.000Z",
      samplingMethod: "algolia_date_search",
      source: "algolia",
      items: [{
        id: 123,
        type: "story",
        depth: 0,
        storyId: 123,
        storyTitle: "HN item 123",
        sourceUrl: "https://news.ycombinator.com/item?id=123",
      }],
    });

    expect(parsed.items[0]?.storyUrl).toBeUndefined();
  });
});

describe("sentiment result schema", () => {
  it("trims overlong item-level judgement snippets from model output", () => {
    const parsed = SentimentResultSchema.parse({
      itemId: 123,
      analyses: [{
        target: "openai",
        sentiment: 1,
        confidence: 0.8,
        relevance: true,
        sarcasm: false,
        comparison: false,
        evidenceSummary: "Positive mention.",
        judgementSnippet: "x".repeat(300),
      }],
    });

    expect(parsed.analyses[0]?.judgementSnippet).toHaveLength(240);
    expect(parsed.analyses[0]?.judgementSnippet.endsWith("...")).toBe(true);
  });
});
