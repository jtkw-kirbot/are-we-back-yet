import { MODEL_CONFIG, TARGET_LABELS, TARGETS } from "./config.js";
import type { HnItem } from "./types.js";

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
        required: ["target", "text", "confidence", "mentionType"],
        properties: {
          target: { type: "string", enum: TARGETS },
          text: { type: "string" },
          confidence: { type: "number" },
          mentionType: { type: "string", enum: ["direct", "comparative", "implied", "irrelevant"] },
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
    max_output_tokens: 1000,
  };
}

export function sentimentRequestBody(item: HnItem, targets: string[]): unknown {
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
    max_output_tokens: 1400,
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
