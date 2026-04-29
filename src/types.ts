import { z } from "zod";
import { TARGETS } from "./config.js";

function trimLongSnippet(value: string): string {
  if (value.length <= 320) return value;
  return `${value.slice(0, 317).trimEnd()}...`;
}

export const TargetSchema = z.enum(TARGETS);
export type Target = z.infer<typeof TargetSchema>;

export const SamplingMethodSchema = z.enum([
  "frontpage_title_snapshot",
  "historical_frontpage_title_snapshot",
]);
export type SamplingMethod = z.infer<typeof SamplingMethodSchema>;

export const RunStateSchema = z.enum([
  "fetched",
  "analysis_processing",
  "complete",
  "failed",
]);
export type RunState = z.infer<typeof RunStateSchema>;

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
  score: z.number(),
  rawWeightedSentiment: z.number(),
  mentionCount: z.number().int().nonnegative(),
  positiveCount: z.number().int().nonnegative(),
  neutralCount: z.number().int().nonnegative(),
  negativeCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  judgementSnippet: z.string().transform(trimLongSnippet),
  evidenceIds: z.array(z.string()),
});
export type DailyEntity = z.infer<typeof DailyEntitySchema>;

export const TitleAnalysisSchema = z.object({
  itemId: z.number(),
  target: TargetSchema,
  sentiment: z.number().int().min(-2).max(2),
  confidence: z.number().min(0).max(1),
  relevance: z.boolean(),
  evidenceSummary: z.string(),
  judgementSnippet: z.string().transform(trimLongSnippet),
});
export type TitleAnalysis = z.infer<typeof TitleAnalysisSchema>;

export const DailyResultSchema = z.object({
  date: z.string(),
  generatedAt: z.string(),
  samplingMethod: SamplingMethodSchema,
  winner: TargetSchema,
  dailyJudgementSnippet: z.string().transform(trimLongSnippet),
  winnerExplanation: z.string().transform(trimLongSnippet),
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
