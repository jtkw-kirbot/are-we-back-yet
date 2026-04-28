import { describe, expect, it } from "vitest";
import { sentimentTargetsForMentions } from "../src/entity-routing.js";
import { entityRequestBody, sentimentRequestBody } from "../src/prompts.js";
import { MentionSchema, type HnItem } from "../src/types.js";

describe("entity sentiment routing", () => {
  const copilotBillingItem: HnItem = {
    id: 47923591,
    type: "comment",
    depth: 2,
    storyId: 47923357,
    storyTitle: "GitHub Copilot is moving to usage-based billing",
    storyUrl: "https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/",
    sourceUrl: "https://news.ycombinator.com/item?id=47923591",
    text: "27x for Opus is genuinely shocking. at that point you're not paying for convenience anymore, you're just paying a GitHub tax.",
  };

  it("keeps old mention outputs parseable with conservative defaults", () => {
    const mention = MentionSchema.parse({
      target: "anthropic",
      text: "Sonnet",
      confidence: 0.91,
      mentionType: "direct",
    });

    expect(mention.aspect).toBe("unclear");
    expect(mention.surface).toBe("direct_provider");
    expect(mention.sentimentOwner).toBe("same_as_target");
    expect(sentimentTargetsForMentions([mention])).toEqual(["anthropic"]);
  });

  it("adds the tracked wrapper when model pricing sentiment belongs to a reseller surface", () => {
    const mentions = MentionSchema.array().parse([
      {
        target: "anthropic",
        text: "Sonnet",
        confidence: 0.98,
        mentionType: "implied",
        surface: "github_copilot",
        aspect: "reseller_billing",
        sentimentOwner: "microsoft_copilot",
      },
    ]);

    expect(sentimentTargetsForMentions(mentions)).toEqual(["anthropic", "microsoft_copilot"]);
  });

  it("uses tracked surface fallback when the owner hint is missing or conservative", () => {
    const mentions = MentionSchema.array().parse([
      {
        target: "openai",
        text: "GPT 5.4 mini",
        confidence: 0.96,
        mentionType: "direct",
        surface: "GitHub Copilot",
        aspect: "reseller_billing",
        sentimentOwner: "same_as_target",
      },
    ]);

    expect(sentimentTargetsForMentions(mentions)).toEqual(["openai", "microsoft_copilot"]);
  });

  it("uses thread context to add the tracked surface for billing discussions", () => {
    const mentions = MentionSchema.array().parse([
      {
        target: "anthropic",
        text: "Opus",
        confidence: 0.96,
        mentionType: "implied",
      },
    ]);

    expect(sentimentTargetsForMentions(mentions, copilotBillingItem)).toEqual(["anthropic", "microsoft_copilot"]);
  });

  it("does not invent a tracked target for untracked reseller surfaces", () => {
    const mentions = MentionSchema.array().parse([
      {
        target: "anthropic",
        text: "Claude",
        confidence: 0.95,
        mentionType: "direct",
        surface: "OpenRouter",
        aspect: "reseller_billing",
        sentimentOwner: "unknown",
      },
    ]);

    expect(sentimentTargetsForMentions(mentions)).toEqual(["anthropic"]);
  });

  it("passes detected ownership hints into sentiment scoring", () => {
    const mentions = MentionSchema.array().parse([
      {
        target: "anthropic",
        text: "Opus",
        confidence: 0.96,
        mentionType: "implied",
        surface: "github_copilot",
        aspect: "reseller_billing",
        sentimentOwner: "microsoft_copilot",
      },
    ]);

    const body = sentimentRequestBody(copilotBillingItem, ["anthropic", "microsoft_copilot"], mentions) as {
      input: Array<{ content: string }>;
    };
    const systemPrompt = body.input[0]?.content ?? "";
    const userPayload = JSON.parse(body.input[1]?.content ?? "{}") as { detectedMentions?: unknown[] };

    expect(systemPrompt).toContain("Separate the underlying model/provider from the surface");
    expect(userPayload.detectedMentions).toEqual(mentions);
  });

  it("tells models not to route harness-only praise to the underlying provider", () => {
    const harnessItem: HnItem = {
      id: 47925062,
      type: "comment",
      depth: 1,
      storyId: 47920787,
      storyTitle: "Show HN: OSS Agent I built topped the TerminalBench on Gemini-3-flash-preview",
      sourceUrl: "https://news.ycombinator.com/item?id=47925062",
      text: "Really impressive results. The point about the harness mattering more than the model is spot on.",
    };

    const entityBody = entityRequestBody(harnessItem) as { input: Array<{ content: string }> };
    const sentimentBody = sentimentRequestBody(harnessItem, ["google_gemini"]) as { input: Array<{ content: string }> };

    expect(entityBody.input[0]?.content).toContain("harness, scaffold, benchmark setup");
    expect(sentimentBody.input[0]?.content).toContain("merely because the project uses that model");
    expect(sentimentBody.input[0]?.content).toContain("harness, scaffold, or surrounding tool matters more than the model");
  });
});
