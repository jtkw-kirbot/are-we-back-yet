import { describe, expect, it } from "vitest";
import { DailyResultSchema, RawDaySchema } from "../src/types.js";

const entity = {
  score: 0.1,
  rawWeightedSentiment: 0.2,
  mentionCount: 3,
  positiveCount: 2,
  neutralCount: 1,
  negativeCount: 0,
  confidence: 0.8,
  judgementSnippet: "Positive due to stories and comments [E1].",
  evidenceIds: ["E1"],
};

describe("daily result schema", () => {
  it("requires all four canonical entities and evidence-backed snippets", () => {
    const parsed = DailyResultSchema.parse({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_story_comment_snapshot",
      winner: "openai",
      dailyJudgementSnippet: "OpenAI led the day [E1].",
      winnerExplanation: "OpenAI had the strongest positive signal [E1].",
      lowConfidence: true,
      closeCall: false,
      margin: 0.12,
      models: {
        titleAnalysis: "gpt-5.4-2026-03-05",
      },
      methodVersion: {
        titleAnalysisPrompt: "model-owned-story-comments-v1",
        aggregation: "model-owned-rollup-v1",
        schema: "daily-v3",
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

  it("allows providers with no relevant HN story/comment signal to be N/A", () => {
    const parsed = DailyResultSchema.parse({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_story_comment_snapshot",
      winner: null,
      dailyJudgementSnippet: "N/A.",
      winnerExplanation: "No tracked provider had relevant HN story/comment signal.",
      lowConfidence: true,
      closeCall: false,
      margin: null,
      models: { titleAnalysis: "gpt-5.4-2026-03-05" },
      methodVersion: {
        titleAnalysisPrompt: "model-owned-story-comments-v1",
        aggregation: "model-owned-rollup-v1",
        schema: "daily-v3",
      },
      entities: {
        openai: { ...entity, score: null, rawWeightedSentiment: null, mentionCount: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, confidence: 0, judgementSnippet: "N/A", evidenceIds: [] },
        anthropic: { ...entity, score: null, rawWeightedSentiment: null, mentionCount: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, confidence: 0, judgementSnippet: "N/A", evidenceIds: [] },
        google_gemini: { ...entity, score: null, rawWeightedSentiment: null, mentionCount: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, confidence: 0, judgementSnippet: "N/A", evidenceIds: [] },
        microsoft_copilot: { ...entity, score: null, rawWeightedSentiment: null, mentionCount: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, confidence: 0, judgementSnippet: "N/A", evidenceIds: [] },
      },
      evidence: [],
    });

    expect(parsed.winner).toBeNull();
    expect(parsed.entities.openai.score).toBeNull();
  });
});

describe("raw day schema", () => {
  it("accepts front-page HN items with omitted story urls", () => {
    const parsed = RawDaySchema.parse({
      date: "2026-04-28",
      fetchedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "frontpage_story_comment_snapshot",
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

  it("accepts historical front-page snapshots", () => {
    const parsed = RawDaySchema.parse({
      date: "2026-04-20",
      fetchedAt: "2026-04-29T04:00:00.000Z",
      samplingMethod: "historical_frontpage_story_comment_snapshot",
      source: "hn_front_html_firebase",
      items: [],
    });

    expect(parsed.samplingMethod).toBe("historical_frontpage_story_comment_snapshot");
  });
});
