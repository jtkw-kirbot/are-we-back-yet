import { z } from "zod";
import { TARGETS } from "./config.js";

export const TargetSchema = z.enum(TARGETS);
export type Target = z.infer<typeof TargetSchema>;

export const SamplingMethodSchema = z.enum([
  "frontpage_title_snapshot",
  "historical_frontpage_title_snapshot",
  "frontpage_story_comment_snapshot",
  "historical_frontpage_story_comment_snapshot",
]);
export type SamplingMethod = z.infer<typeof SamplingMethodSchema>;

export const RunStateSchema = z.enum([
  "fetched",
  "analysis_processing",
  "complete",
  "failed",
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const HnCommentSchema = z.object({
  id: z.number(),
  by: z.string().optional(),
  time: z.number().optional(),
  text: z.string(),
  sourceUrl: z.string(),
});
export type HnComment = z.infer<typeof HnCommentSchema>;

export const HnItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  by: z.string().optional(),
  time: z.number().optional(),
  title: z.string(),
  url: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  rank: z.number().int().positive(),
  depth: z.literal(0),
  storyId: z.number(),
  storyTitle: z.string(),
  storyUrl: z.string().optional(),
  sourceUrl: z.string(),
  topComments: z.array(HnCommentSchema).default([]),
});
export type HnItem = z.infer<typeof HnItemSchema>;

export const RawDaySchema = z.object({
  date: z.string(),
  fetchedAt: z.string(),
  samplingMethod: SamplingMethodSchema,
  source: z.enum(["firebase", "hn_front_html_firebase"]),
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
  cachedInputTokens: z.number().int().nonnegative().default(0),
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
    titleAnalysis: ResponseStageInfoSchema.optional(),
  }).default({}),
  error: z.string().optional(),
});
export type RunFile = z.infer<typeof RunFileSchema>;

export const EvidenceSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  entity: TargetSchema,
  hnItemId: z.number(),
  url: z.string(),
  role: z.enum(["positive_driver", "negative_driver", "neutral_context"]),
  summary: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const DailyEntitySchema = z.object({
  score: z.number().min(-1).max(1).nullable(),
  rawWeightedSentiment: z.number().min(-1).max(1).nullable(),
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
  winner: TargetSchema.nullable(),
  dailyJudgementSnippet: z.string(),
  winnerExplanation: z.string(),
  lowConfidence: z.boolean(),
  closeCall: z.boolean(),
  margin: z.number().nullable(),
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
