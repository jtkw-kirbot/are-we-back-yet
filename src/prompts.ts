import { MODEL_CONFIG, TARGET_LABELS, TARGETS } from "./config.js";
import type { HnItem, Mention } from "./types.js";

export const entityJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["itemId", "mentions", "unknownAiEntities"],
  properties: {
    itemId: { type: "integer" },
    mentions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["target", "text", "confidence", "mentionType", "surface", "aspect", "sentimentOwner"],
        properties: {
          target: { type: "string", enum: TARGETS },
          text: { type: "string" },
          confidence: { type: "number" },
          mentionType: { type: "string", enum: ["direct", "comparative", "implied", "irrelevant"] },
          surface: { type: "string" },
          aspect: {
            type: "string",
            enum: [
              "model_quality",
              "provider_pricing",
              "reseller_billing",
              "product_ux",
              "company_strategy",
              "procurement",
              "unclear",
            ],
          },
          sentimentOwner: { type: "string", enum: [...TARGETS, "same_as_target", "unknown"] },
        },
      },
    },
    unknownAiEntities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "likelyTarget", "confidence", "reason"],
        properties: {
          text: { type: "string" },
          likelyTarget: { type: "string", enum: [...TARGETS, "unknown"] },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export const sentimentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["itemId", "analyses"],
  properties: {
    itemId: { type: "integer" },
    analyses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "target",
          "sentiment",
          "confidence",
          "relevance",
          "sarcasm",
          "comparison",
          "evidenceSummary",
          "judgementSnippet",
        ],
        properties: {
          target: { type: "string", enum: TARGETS },
          sentiment: { type: "integer", minimum: -2, maximum: 2 },
          confidence: { type: "number" },
          relevance: { type: "boolean" },
          sarcasm: { type: "boolean" },
          comparison: { type: "boolean" },
          evidenceSummary: { type: "string" },
          judgementSnippet: { type: "string" },
        },
      },
    },
  },
};

export const adjudicationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "winner",
    "dailyJudgementSnippet",
    "winnerExplanation",
    "entityJudgements",
  ],
  properties: {
    winner: { type: "string", enum: TARGETS },
    dailyJudgementSnippet: { type: "string" },
    winnerExplanation: { type: "string" },
    entityJudgements: {
      type: "object",
      additionalProperties: false,
      required: TARGETS,
      properties: Object.fromEntries(TARGETS.map((target) => [target, { type: "string" }])),
    },
  },
};

export function jsonSchemaFormat(name: string, schema: unknown): unknown {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema,
  };
}

export function entityRequestBody(item: HnItem): unknown {
  return {
    model: MODEL_CONFIG.entity.model,
    reasoning: { effort: MODEL_CONFIG.entity.reasoningEffort },
    input: [
      {
        role: "system",
        content: [
          "Identify references to OpenAI, Anthropic, Google Gemini, and Microsoft Copilot in Hacker News items.",
          "Use canonical targets only: openai, anthropic, google_gemini, microsoft_copilot.",
          "Copilot counts as Microsoft only when the context is an AI assistant, coding assistant, Bing/Windows/M365 Copilot, or GitHub Copilot.",
          "Do not count generic Microsoft or Google sentiment unless the item is clearly about AI assistant/model context.",
          "Use story title and URL as thread context for implied product mentions in comments.",
          "Do not create an implied model/provider mention from story context alone when the comment is only about an open-source project, benchmark harness, agent scaffold, editor integration, evaluation setup, or implementation mechanics.",
          "When a comment says the harness, scaffold, benchmark setup, or surrounding tool matters more than the model, treat the provider mention as irrelevant unless the comment separately judges model quality, pricing, access, or provider strategy.",
          "For each mention, identify the surface where the entity appears, such as direct_provider, github_copilot, openrouter, cursor, chatgpt, claude_code, google_ai_studio, or unknown.",
          "Classify the aspect as model_quality, provider_pricing, reseller_billing, product_ux, company_strategy, procurement, or unclear.",
          "Set sentimentOwner to the canonical target that likely owns the sentiment, same_as_target, or unknown.",
          "If a comment criticizes billing multipliers, included credits, quotas, plan limits, or wrapper pricing for a named model inside another product, keep the model-owner mention but set sentimentOwner to the product surface when it is one of the canonical targets.",
          "If a tracked product surface is the likely owner because of the story context, include that product as an implied mention even if the comment body only names the underlying model.",
          "Use same_as_target for direct API/provider pricing, model quality, product behavior, company strategy, or explicit blame aimed at the model owner.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          itemId: item.id,
          type: item.type,
          storyTitle: item.storyTitle,
          storyUrl: item.storyUrl,
          title: item.title,
          url: item.url,
          text: item.text,
        }),
      },
    ],
    text: { format: jsonSchemaFormat("entity_detection", entityJsonSchema) },
  };
}

export function sentimentRequestBody(item: HnItem, targets: string[], detectedMentions: Mention[] = []): unknown {
  return {
    model: MODEL_CONFIG.sentiment.model,
    reasoning: { effort: MODEL_CONFIG.sentiment.reasoningEffort },
    input: [
      {
        role: "system",
        content: [
          "Score aspect-based sentiment in a Hacker News item toward the listed AI lab/product targets.",
          "Use -2 strongly negative, -1 mildly negative, 0 neutral/mixed/unclear, +1 mildly positive, +2 strongly positive.",
          "Judge the sentiment toward each target, not the overall mood of the comment.",
          "Separate the underlying model/provider from the surface that sells, wraps, or meters it.",
          "Do not convert praise or criticism of an open-source project, benchmark harness, agent scaffold, editor integration, evaluation setup, or implementation technique into sentiment toward the model provider merely because the project uses that model.",
          "Benchmark results count as provider/model sentiment only when the item clearly attributes performance to the model itself or directly compares model quality; otherwise mark the provider neutral or not relevant.",
          "If the text says the harness, scaffold, or surrounding tool matters more than the model, do not assign that praise to the model provider unless there is a separate direct judgment of the model.",
          "If a comment criticizes reseller billing, plan limits, included credits, usage multipliers, quotas, IDE integration, or wrapper availability, assign that sentiment to the surface product when it is one of the listed targets.",
          "Do not count reseller or wrapper pricing complaints as negative toward the model owner unless the commenter explicitly blames the provider, direct API pricing, model quality, or company strategy.",
          "If an untracked reseller or wrapper is the true object of the complaint, mark the provider target as neutral or not relevant unless the text directly judges that provider.",
          "If both the surface and provider are explicitly judged, score both separately.",
          "Return a concise item-level judgement snippet and evidence summary for each target.",
          "Be conservative with sarcasm, jokes, and off-topic references.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          itemId: item.id,
          targets,
          targetLabels: TARGET_LABELS,
          detectedMentions,
          type: item.type,
          depth: item.depth,
          storyTitle: item.storyTitle,
          storyUrl: item.storyUrl,
          title: item.title,
          url: item.url,
          text: item.text,
        }),
      },
    ],
    text: { format: jsonSchemaFormat("sentiment_scoring", sentimentJsonSchema) },
  };
}

export function adjudicationInput(payload: unknown): unknown {
  return [
    {
      role: "system",
      content: [
        "You adjudicate the daily Hacker News sentiment winner among OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.",
        "Use the provided aggregate scores and evidence only.",
        "Snippets may cite evidence using tokens like [E1]. Do not write raw URLs. Do not cite evidence IDs that were not provided.",
        "Mention why the winner won and how the other entities compared. Avoid overstating low-sample or close-call days.",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(payload) },
  ];
}
