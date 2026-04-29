import { describe, expect, it } from "vitest";
import { aggregateDailyEvidence } from "../src/aggregate.js";
import type { Evidence } from "../src/types.js";

function evidence(id: string, storyId: number, target: "openai" | "anthropic", stance: -2 | -1 | 0 | 1 | 2): Evidence {
  return {
    id,
    storyId,
    hnUrl: `https://news.ycombinator.com/item?id=${storyId}`,
    sourceType: "title",
    excerpt: `${target} evidence`,
    annotations: [{
      target,
      referenceBasis: "explicit_alias",
      stance,
      stanceLabel: stance === -2 ? "strong_negative" : stance === -1 ? "negative" : stance === 0 ? "neutral_mixed" : stance === 1 ? "positive" : "strong_positive",
      relevance: "central",
      topic: "model_quality",
      confidence: "high",
      attributionConfidence: "high",
      rationale: "Direct target evidence.",
    }],
  };
}

describe("aggregateDailyEvidence", () => {
  it("ranks mentioned targets from most negative to most positive and excludes unmentioned targets", () => {
    const result = aggregateDailyEvidence({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      evidence: [
        evidence("E1", 1, "openai", -2),
        evidence("E2", 2, "anthropic", 1),
      ],
    });

    expect(result.ranking.map((item) => item.target)).toEqual(["openai", "anthropic"]);
    expect(result.unmentioned).toEqual(["google_gemini", "microsoft_copilot"]);
    expect(result.primarySignalTargets).toEqual(["openai"]);
    expect(result.ranking[0]?.bucket).toBe("negative");
  });

  it("caps single-story support while preserving multi-target evidence", () => {
    const result = aggregateDailyEvidence({
      date: "2026-04-28",
      generatedAt: "2026-04-29T04:00:00.000Z",
      evidence: [{
        id: "E1",
        storyId: 1,
        hnUrl: "https://news.ycombinator.com/item?id=1",
        sourceType: "comment",
        excerpt: "Claude beats GPT here",
        annotations: [
          {
            target: "anthropic",
            referenceBasis: "explicit_alias",
            stance: 2,
            stanceLabel: "strong_positive",
            relevance: "central",
            topic: "comparison",
            confidence: "high",
            attributionConfidence: "high",
            rationale: "Claude is praised.",
          },
          {
            target: "openai",
            referenceBasis: "explicit_alias",
            stance: -1,
            stanceLabel: "negative",
            relevance: "direct",
            topic: "comparison",
            confidence: "high",
            attributionConfidence: "high",
            rationale: "GPT is treated as worse.",
          },
        ],
      }],
    });

    expect(result.evidence[0]?.annotations).toHaveLength(2);
    expect(result.ranking.find((item) => item.target === "anthropic")?.evidenceIds).toEqual(["E1"]);
    expect(result.ranking.find((item) => item.target === "openai")?.evidenceIds).toEqual(["E1"]);
  });
});
