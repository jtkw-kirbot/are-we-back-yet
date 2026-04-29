import { MODEL_CONFIG, TARGET_ALIAS_HINTS, TARGET_LABELS, TARGETS } from "./config.js";
import type { DailyResult, RawDay } from "./types.js";

const referenceBases = [
  "explicit_alias",
  "title_context",
  "url_context",
  "implicit_coreference",
  "model_inferred_alias",
];

const stanceLabels = [
  "strong_negative",
  "negative",
  "neutral_mixed",
  "positive",
  "strong_positive",
];

const relevanceValues = ["central", "direct", "incidental"];
const confidenceValues = ["low", "medium", "high"];
const topicValues = [
  "model_quality",
  "pricing",
  "access",
  "policy",
  "trust",
  "business_strategy",
  "legal_ip",
  "privacy",
  "safety",
  "comparison",
  "release",
  "other",
];

export const evidenceDetectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["evidence"],
  properties: {
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "storyId", "commentId", "hnUrl", "sourceType", "excerpt", "annotations"],
        properties: {
          id: { type: "string", pattern: "^E[0-9]+$" },
          storyId: { type: "integer" },
          commentId: { type: ["integer", "null"] },
          hnUrl: { type: "string" },
          sourceType: { type: "string", enum: ["title", "comment"] },
          excerpt: { type: "string" },
          annotations: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "target",
                "referenceBasis",
                "stance",
                "stanceLabel",
                "relevance",
                "topic",
                "confidence",
                "attributionConfidence",
                "rationale",
              ],
              properties: {
                target: { type: "string", enum: TARGETS },
                referenceBasis: { type: "string", enum: referenceBases },
                stance: { type: "integer", enum: [-2, -1, 0, 1, 2] },
                stanceLabel: { type: "string", enum: stanceLabels },
                relevance: { type: "string", enum: relevanceValues },
                topic: { type: "string", enum: topicValues },
                confidence: { type: "string", enum: confidenceValues },
                attributionConfidence: { type: "string", enum: confidenceValues },
                rationale: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

export const dailySummaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headlineSummary", "targetSummaries"],
  properties: {
    headlineSummary: { type: "string" },
    targetSummaries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["target", "summary"],
        properties: {
          target: { type: "string", enum: TARGETS },
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

export function evidenceDetectionRequestBody(day: RawDay): unknown {
  return {
    model: MODEL_CONFIG.evidenceDetection.model,
    reasoning: { effort: MODEL_CONFIG.evidenceDetection.reasoningEffort },
    input: [
      {
        role: "system",
        content: [
          "You identify source-backed Hacker News sentiment evidence for a fixed set of AI targets.",
          "Return JSON only, matching the supplied structured output schema.",
          "Use only the story title, URL/domain, HN URL, metadata, and provided top-level comments.",
          "Do not use article bodies, omitted comments, sibling-comment context, or outside knowledge as sentiment evidence.",
          "The tracked targets are openai, anthropic, google_gemini, and microsoft_copilot.",
          "Alias hints are context, not hard rules. Generic Google or Microsoft references count only when the AI model, assistant, product, or Copilot context is clear.",
          "Annotate a title or comment when it clearly applies to a tracked target through explicit_alias, title_context, url_context, implicit_coreference, or model_inferred_alias.",
          "A comment can use title_context, url_context, or implicit_coreference only when its own text plus the story title/domain makes provider attribution clear.",
          "Do not propagate a target from one top-level comment to a sibling top-level comment.",
          "Omit generic AI sentiment, article-quality discussion, HN moderation, benchmark-methodology discussion, and wrapper/tool criticism unless the wording clearly assigns sentiment to the tracked provider.",
          "A single evidence record may contain multiple target annotations when the same excerpt compares or discusses multiple tracked targets.",
          "Judge each target independently. A positive comparison for one target does not automatically create negative evidence for another unless the excerpt supports it.",
          "Use stance -2 for strong criticism, -1 for mild criticism, 0 for factual/ambiguous/mixed, 1 for mild praise, and 2 for strong praise.",
          "stanceLabel must exactly match stance: -2 strong_negative, -1 negative, 0 neutral_mixed, 1 positive, 2 strong_positive.",
          "Excerpts must be exact contiguous verbatim substrings copied from the title or comment, long enough to audit the annotation.",
          "Do not paraphrase, splice separate phrases together, normalize punctuation, add ellipses, or quote text that is not exactly present in the source.",
          "Use evidence ids E1, E2, E3 in the order you emit evidence.",
          "If there is no accepted evidence, return an empty evidence array.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          date: day.date,
          samplingMethod: day.samplingMethod,
          targetLabels: TARGET_LABELS,
          aliasHints: TARGET_ALIAS_HINTS,
          stories: day.items.map((item) => ({
            storyId: item.id,
            rank: item.rank,
            title: item.title,
            hnUrl: item.sourceUrl,
            outboundUrl: item.url,
            outboundDomain: item.url ? safeDomain(item.url) : undefined,
            score: item.score,
            descendants: item.descendants,
            by: item.by,
            time: item.time,
            topComments: item.topComments.map((comment) => ({
              commentId: comment.id,
              by: comment.by,
              time: comment.time,
              hnUrl: comment.sourceUrl,
              text: comment.text,
            })),
          })),
        }),
      },
    ],
    store: false,
    text: {
      format: jsonSchemaFormat(
        "hn_sentiment_evidence_detection",
        "Accepted source-backed HN title/comment evidence records with per-target sentiment annotations.",
        evidenceDetectionJsonSchema,
      ),
    },
  };
}

export function dailySummaryRequestBody(result: DailyResult): unknown {
  return {
    model: MODEL_CONFIG.dailySummary.model,
    reasoning: { effort: MODEL_CONFIG.dailySummary.reasoningEffort },
    input: [
      {
        role: "system",
        content: [
          "You write a short daily explanation from an already aggregated Hacker News sentiment result.",
          "Return JSON only, matching the supplied structured output schema.",
          "Do not change rankings, buckets, support, confidence, evidence, or target membership.",
          "Use only the approved evidence records and ranking fields in the user payload.",
          "The UI displays providers from most positive to most negative, regardless of the input rankingDirection.",
          "Cite evidence with [E1] tokens only. Do not include raw URLs.",
          "headlineSummary must include at least one [E#] citation whenever any approved evidence exists.",
          "Every target summary must include at least one [E#] citation from that target's evidenceIds.",
          "Use user-facing wording: say limited evidence, not low support, when a ranked position depends on thin evidence.",
          "Disclose close ties when tiedWith is non-empty or rankNote is close_tie.",
          "Avoid ordinal rank phrases like ranked first, tied for first, or third; describe sentiment direction, evidence strength, and ties instead.",
          "Keep headlineSummary to one concise sentence.",
          "Each ranked target must have one concise summary grounded in that target's evidence ids.",
          "Do not write summaries for unmentioned targets.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          date: result.date,
          rankingDirection: result.rankingDirection,
          primarySignalTargets: result.primarySignalTargets,
          primarySignalDirection: result.primarySignalDirection,
          ranking: result.ranking.map((item) => ({
            target: item.target,
            label: TARGET_LABELS[item.target],
            bucket: item.bucket,
            direction: item.direction,
            support: item.support,
            confidence: item.confidence,
            displayRank: item.displayRank,
            tiedWith: item.tiedWith,
            rankNote: item.rankNote,
            evidenceBalance: item.evidenceBalance,
            evidenceIds: item.evidenceIds,
          })),
          unmentioned: result.unmentioned,
          evidence: result.evidence.map((item) => ({
            id: item.id,
            storyId: item.storyId,
            commentId: item.commentId,
            sourceType: item.sourceType,
            excerpt: item.excerpt,
            annotations: item.annotations.map((annotation) => ({
              target: annotation.target,
              stance: annotation.stance,
              relevance: annotation.relevance,
              topic: annotation.topic,
              confidence: annotation.confidence,
              attributionConfidence: annotation.attributionConfidence,
              rationale: annotation.rationale,
            })),
          })),
        }),
      },
    ],
    store: false,
    text: {
      format: jsonSchemaFormat(
        "hn_sentiment_daily_summary",
        "Cited headline and target summaries for an already aggregated daily HN sentiment ranking.",
        dailySummaryJsonSchema,
      ),
    },
  };
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
