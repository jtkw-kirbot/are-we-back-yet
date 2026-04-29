import { z } from "zod";
import { TARGETS } from "./config.js";

function trimLongSnippet(value: string): string {
  if (value.length <= 240) return value;
  return `${value.slice(0, 237).trimEnd()}...`;
}

export const TargetSchema = z.enum(TARGETS);
export type Target = z.infer<typeof TargetSchema>;

export const SamplingMethodSchema = z.enum([
  "frontpage_snapshot",
  "algolia_date_search",
]);
export type SamplingMethod = z.infer<typeof SamplingMethodSchema>;

export const RunStateSchema = z.enum([
  "fetched",
  "entity_processing",
  "entity_complete",
  "sentiment_processing",
  "sentiment_complete",
  "complete",
  "failed",
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const HnItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  by: z.string().optional(),
  time: z.number().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  text: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  depth: z.number(),
  parentId: z.number().optional(),
  storyId: z.number(),
  storyTitle: z.string(),
  storyUrl: z.string().optional(),
  sourceUrl: z.string(),
});
export type HnItem = z.infer<typeof HnItemSchema>;

export const RawDaySchema = z.object({
  date: z.string(),
  fetchedAt: z.string(),
  samplingMethod: SamplingMethodSchema,
  source: z.enum(["firebase", "algolia"]),
  items: z.array(HnItemSchema),
});
export type RawDay = z.infer<typeof RawDaySchema>;

export const ResponseStageInfoSchema = z.object({
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  processedCount: z.number().int().nonnegative().default(0),
  successCount: z.number().int().nonnegative().default(0),
  quarantineCount: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
});
export type ResponseStageInfo = z.infer<typeof ResponseStageInfoSchema>;

export const RunFileSchema = z.object({
  date: z.string(),
  samplingMethod: SamplingMethodSchema,
  state: RunStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  responses: z.object({
    entity: ResponseStageInfoSchema.optional(),
    sentiment: ResponseStageInfoSchema.optional(),
  }).default({}),
  error: z.string().optional(),
});
export type RunFile = z.infer<typeof RunFileSchema>;

export const MentionSchema = z.object({
  target: TargetSchema,
  text: z.string(),
  confidence: z.number().min(0).max(1),
  mentionType: z.enum(["direct", "comparative", "implied", "irrelevant"]),
  surface: z.string().default("direct_provider"),
  aspect: z.enum([
    "model_quality",
    "provider_pricing",
    "reseller_billing",
    "product_ux",
    "company_strategy",
    "procurement",
    "unclear",
  ]).default("unclear"),
  sentimentOwner: z.union([
    TargetSchema,
    z.literal("same_as_target"),
    z.literal("unknown"),
  ]).default("same_as_target"),
});
export type Mention = z.infer<typeof MentionSchema>;

export const UnknownMentionSchema = z.object({
  text: z.string(),
  likelyTarget: z.union([TargetSchema, z.literal("unknown")]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type UnknownMention = z.infer<typeof UnknownMentionSchema>;

export const EntityResultSchema = z.object({
  itemId: z.number(),
  mentions: z.array(MentionSchema),
  unknownAiEntities: z.array(UnknownMentionSchema).default([]),
});
export type EntityResult = z.infer<typeof EntityResultSchema>;

export const SentimentAnalysisSchema = z.object({
  target: TargetSchema,
  sentiment: z.number().int().min(-2).max(2),
  confidence: z.number().min(0).max(1),
  relevance: z.boolean(),
  sarcasm: z.boolean().default(false),
  comparison: z.boolean().default(false),
  evidenceSummary: z.string(),
  judgementSnippet: z.string().transform(trimLongSnippet),
});
export type SentimentAnalysis = z.infer<typeof SentimentAnalysisSchema>;

export const SentimentResultSchema = z.object({
  itemId: z.number(),
  analyses: z.array(SentimentAnalysisSchema),
});
export type SentimentResult = z.infer<typeof SentimentResultSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  entity: TargetSchema,
  hnItemId: z.number(),
  url: z.string(),
  role: z.enum(["positive_driver", "negative_driver", "neutral_context"]),
  summary: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const DailyEntitySchema = z.object({
  score: z.number(),
  rawWeightedSentiment: z.number(),
  mentionCount: z.number().int().nonnegative(),
  positiveCount: z.number().int().nonnegative(),
  neutralCount: z.number().int().nonnegative(),
  negativeCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  judgementSnippet: z.string(),
  evidenceIds: z.array(z.string()),
});
export type DailyEntity = z.infer<typeof DailyEntitySchema>;

export const DailyResultSchema = z.object({
  date: z.string(),
  generatedAt: z.string(),
  samplingMethod: SamplingMethodSchema,
  winner: TargetSchema,
  dailyJudgementSnippet: z.string(),
  winnerExplanation: z.string(),
  lowConfidence: z.boolean(),
  closeCall: z.boolean(),
  margin: z.number(),
  models: z.record(z.string(), z.string()),
  methodVersion: z.record(z.string(), z.string()),
  entities: z.object({
    openai: DailyEntitySchema,
    anthropic: DailyEntitySchema,
    google_gemini: DailyEntitySchema,
    microsoft_copilot: DailyEntitySchema,
  }),
  evidence: z.array(EvidenceSchema),
});
export type DailyResult = z.infer<typeof DailyResultSchema>;

export const SiteIndexSchema = z.object({
  generatedAt: z.string(),
  targets: z.array(TargetSchema),
  days: z.array(DailyResultSchema),
});
export type SiteIndex = z.infer<typeof SiteIndexSchema>;
