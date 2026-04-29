import { MODEL_CONFIG, TARGET_LABELS, TARGETS } from "./config.js";
import type { RawDay } from "./types.js";

export const titleAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "winner",
    "dailyJudgementSnippet",
    "winnerExplanation",
    "entities",
    "evidence",
  ],
  properties: {
    winner: { type: ["string", "null"], enum: [...TARGETS, null] },
    dailyJudgementSnippet: { type: "string" },
    winnerExplanation: { type: "string" },
    entities: {
      type: "object",
      additionalProperties: false,
      required: TARGETS,
      properties: Object.fromEntries(TARGETS.map((target) => [target, {
        type: "object",
        additionalProperties: false,
        required: [
          "score",
          "mentionCount",
          "positiveCount",
          "neutralCount",
          "negativeCount",
          "confidence",
          "judgementSnippet",
          "evidenceIds",
        ],
        properties: {
          score: { type: ["number", "null"], minimum: -1, maximum: 1 },
          mentionCount: { type: "integer", minimum: 0 },
          positiveCount: { type: "integer", minimum: 0 },
          neutralCount: { type: "integer", minimum: 0 },
          negativeCount: { type: "integer", minimum: 0 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          judgementSnippet: { type: "string" },
          evidenceIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      }])),
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

export function jsonSchemaFormat(name: string, description: string, schema: unknown): unknown {
  return {
    type: "json_schema",
    name,
    description,
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
          "You evaluate Hacker News front-page stories using only each story title and the provided top-level Hacker News comments.",
          "Return JSON only, matching the supplied structured output schema.",
          "Do not infer sentiment from article bodies, linked pages, omitted comments, or your own outside knowledge.",
          "The task is to produce the final daily Hacker News story-and-comment sentiment report for OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.",
          "You own the final per-provider scores, counts, winner, and written judgement. The application will validate internal consistency but will not recompute the winner from story-level scores.",
          "Use canonical targets only: openai, anthropic, google_gemini, microsoft_copilot.",
          "Entity matching examples: ChatGPT, GPT, Codex, Sora, OpenAI API -> openai; Claude, Claude Code, Sonnet, Opus, Haiku -> anthropic; Gemini, Google AI Studio, Google AI model titles -> google_gemini; GitHub Copilot, Microsoft Copilot, Bing Copilot, Windows Copilot, M365 Copilot -> microsoft_copilot.",
          "Do not count generic Google or Microsoft references unless the story or comments are clearly about their AI assistant, AI model, or Copilot product.",
          "A story can mention multiple targets; judge each target independently for that story.",
          "A provider is relevant only when the HN title or provided HN comments discuss that provider, its model quality, product behavior, pricing, access, company strategy, or a direct comparison.",
          "Do not assign praise or criticism of an open-source harness, benchmark scaffold, editor extension, reseller, or wrapper to an underlying model provider merely because the story uses that model.",
          "If the story/comments criticize pricing, quotas, or usage multipliers in a wrapper product such as GitHub Copilot, assign that sentiment to the wrapper target when it is tracked, not automatically to the model owner.",
          "Use score from -1 to 1 for each provider's final daily vibe: -1 overwhelmingly negative, -0.5 clearly negative, 0 neutral/mixed, +0.5 clearly positive, +1 overwhelmingly positive.",
          "Score should consider relevance strength, volume of relevant stories, intensity, HN comment sentiment, and whether the mention is direct or incidental.",
          "Avoid giving a high score to a provider with only one weak or incidental mention. A single thin positive signal should usually be near neutral unless HN reaction is clearly strong.",
          "A relevant but factual launch, release, benchmark, funding, or policy story is often neutral unless the title or comments clearly praise or criticize the target.",
          "Confidence should reflect how much the title and provided comments support the final score for that provider.",
          "mentionCount is the count of front-page stories with meaningful relevant signal for that provider, not the number of comments.",
          "positiveCount, neutralCount, and negativeCount count those relevant stories by their net provider sentiment and must sum to mentionCount.",
          "For providers with no meaningful relevant HN story/comment signal, set score null, all counts 0, confidence 0, judgementSnippet exactly N/A, and evidenceIds empty.",
          "Evidence must cite HN stories only. Use ids E1, E2, etc. Snippets may cite evidence using [E1] tokens, never raw URLs.",
          "Each ranked provider with a non-null score must have at least one evidence id. Evidence should represent the stories and comments that most affected the provider score.",
          "Do not put a categorical label such as 'slightly positive overall' or 'negative overall' in provider judgement snippets; explain the concrete drivers instead.",
          "Pick winner as the tracked provider with the highest final daily score after considering both sentiment and amount of coverage.",
          "Your dailyJudgementSnippet and winnerExplanation must explain why the winner won. Do not name another provider as having the strongest day unless that provider is the winner.",
          "If winner is not null, start dailyJudgementSnippet and winnerExplanation with the exact winning provider label from targetLabels, such as 'OpenAI' or 'Google Gemini'.",
          "If no tracked provider has any relevant HN story/comment signal, set winner to null and write brief N/A daily judgement text.",
          "If winner is null, start dailyJudgementSnippet and winnerExplanation with 'N/A'.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          date: day.date,
          samplingMethod: day.samplingMethod,
          targetLabels: TARGET_LABELS,
          stories: day.items.map((item) => ({
            itemId: item.id,
            rank: item.rank,
            title: item.title,
            url: item.url,
            hnUrl: item.sourceUrl,
            score: item.score,
            descendants: item.descendants,
            topComments: item.topComments.map((comment) => ({
              commentId: comment.id,
              by: comment.by,
              text: comment.text,
              hnUrl: comment.sourceUrl,
            })),
          })),
        }),
      },
    ],
    store: false,
    text: {
      format: jsonSchemaFormat(
        "story_comment_sentiment_daily_report",
        "Final model-owned daily Hacker News sentiment report with provider scores, winner, snippets, and HN evidence links.",
        titleAnalysisJsonSchema,
      ),
    },
  };
}
