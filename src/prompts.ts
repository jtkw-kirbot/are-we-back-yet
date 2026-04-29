import { MODEL_CONFIG, TARGET_LABELS, TARGETS } from "./config.js";
import type { RawDay } from "./types.js";

export const titleAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "winner",
    "dailyJudgementSnippet",
    "winnerExplanation",
    "entityJudgements",
    "analyses",
    "evidence",
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
    analyses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "itemId",
          "target",
          "sentiment",
          "confidence",
          "relevance",
          "evidenceSummary",
          "judgementSnippet",
        ],
        properties: {
          itemId: { type: "integer" },
          target: { type: "string", enum: TARGETS },
          sentiment: { type: "integer", minimum: -2, maximum: 2 },
          confidence: { type: "number" },
          relevance: { type: "boolean" },
          evidenceSummary: { type: "string" },
          judgementSnippet: { type: "string" },
        },
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "entity", "hnItemId", "url", "role", "summary"],
        properties: {
          id: { type: "string" },
          entity: { type: "string", enum: TARGETS },
          hnItemId: { type: "integer" },
          url: { type: "string" },
          role: {
            type: "string",
            enum: ["positive_driver", "negative_driver", "neutral_context"],
          },
          summary: { type: "string" },
        },
      },
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

export function titleAnalysisRequestBody(day: RawDay): unknown {
  return {
    model: MODEL_CONFIG.titleAnalysis.model,
    reasoning: { effort: MODEL_CONFIG.titleAnalysis.reasoningEffort },
    input: [
      {
        role: "system",
        content: [
          "You evaluate only Hacker News front-page story titles.",
          "Do not infer sentiment from comments, article bodies, linked pages, or your own outside knowledge.",
          "The task is to judge title framing toward OpenAI, Anthropic, Google Gemini, and Microsoft Copilot for this one day.",
          "Use canonical targets only: openai, anthropic, google_gemini, microsoft_copilot.",
          "Entity matching examples: ChatGPT, GPT, Codex, Sora, OpenAI API -> openai; Claude, Claude Code, Sonnet, Opus, Haiku -> anthropic; Gemini, Google AI Studio, Google AI model titles -> google_gemini; GitHub Copilot, Microsoft Copilot, Bing Copilot, Windows Copilot, M365 Copilot -> microsoft_copilot.",
          "Do not count generic Google or Microsoft titles unless the title is clearly about their AI assistant, AI model, or Copilot product.",
          "A title can mention multiple targets; return one analysis per relevant target-title pair.",
          "Do not assign praise or criticism of an open-source harness, benchmark scaffold, editor extension, reseller, or wrapper to an underlying model provider merely because the title says it uses that model.",
          "If the title criticizes pricing, quotas, or usage multipliers in a wrapper product such as GitHub Copilot, assign that sentiment to the wrapper target when it is tracked, not automatically to the model owner.",
          "Use sentiment -2 strongly negative, -1 mildly negative, 0 neutral/mixed/unclear, +1 mildly positive, +2 strongly positive.",
          "A relevant but factual launch, release, benchmark, funding, or policy title is often neutral unless the wording clearly praises or criticizes the target.",
          "Confidence should reflect how much the title alone supports the judgement.",
          "Evidence must cite HN stories only. Use ids E1, E2, etc. Snippets may cite evidence using [E1] tokens, never raw URLs.",
          "Pick the winner as the tracked entity with the most positive title-level vibe after considering both sentiment and amount of title coverage. Avoid giving a high score to an entity with a single weak mention.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          date: day.date,
          samplingMethod: day.samplingMethod,
          targetLabels: TARGET_LABELS,
          titles: day.items.map((item) => ({
            itemId: item.id,
            rank: item.rank,
            title: item.title,
            url: item.url,
            hnUrl: item.sourceUrl,
            score: item.score,
            descendants: item.descendants,
          })),
        }),
      },
    ],
    text: { format: jsonSchemaFormat("title_sentiment_daily_report", titleAnalysisJsonSchema) },
  };
}
