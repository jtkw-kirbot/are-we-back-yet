import { z } from "zod";
import { RAW_SOURCE, SAMPLING_METHOD, TARGETS } from "./config.js";

export const TargetSchema = z.enum(TARGETS);
export type Target = z.infer<typeof TargetSchema>;

export const SamplingMethodSchema = z.literal(SAMPLING_METHOD);
export type SamplingMethod = z.infer<typeof SamplingMethodSchema>;

export const RunStateSchema = z.enum([
  "fetched",
  "analysis_processing",
  "complete",
  "failed",
  "skipped",
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
  source: z.literal(RAW_SOURCE),
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

export const RunObservabilitySchema = z.object({
  evidenceRecords: z.number().int().nonnegative().default(0),
  annotations: z.number().int().nonnegative().default(0),
  annotationsByTarget: z.record(z.string(), z.number().int().nonnegative()).default({}),
  annotationsByReferenceBasis: z.record(z.string(), z.number().int().nonnegative()).default({}),
  deterministicAuditHits: z.number().int().nonnegative().default(0),
  deterministicAuditMisses: z.number().int().nonnegative().default(0),
  deterministicAuditMissSamples: z.array(z.object({
    target: TargetSchema,
    storyId: z.number(),
    commentId: z.number().optional(),
    sourceType: z.enum(["title", "comment"]),
    alias: z.string(),
  })).default([]),
});
export type RunObservability = z.infer<typeof RunObservabilitySchema>;

export const RunFileSchema = z.object({
  date: z.string(),
  samplingMethod: SamplingMethodSchema,
  state: RunStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  responses: z.object({
    evidenceDetection: ResponseStageInfoSchema.optional(),
    dailySummary: ResponseStageInfoSchema.optional(),
  }).default({}),
  observability: RunObservabilitySchema.optional(),
  error: z.string().optional(),
});
export type RunFile = z.infer<typeof RunFileSchema>;

export const ReferenceBasisSchema = z.enum([
  "explicit_alias",
  "title_context",
  "url_context",
  "implicit_coreference",
  "model_inferred_alias",
]);
export type ReferenceBasis = z.infer<typeof ReferenceBasisSchema>;

export const StanceSchema = z.union([
  z.literal(-2),
  z.literal(-1),
  z.literal(0),
  z.literal(1),
  z.literal(2),
]);
export type Stance = z.infer<typeof StanceSchema>;

export const StanceLabelSchema = z.enum([
  "strong_negative",
  "negative",
  "neutral_mixed",
  "positive",
  "strong_positive",
]);
export type StanceLabel = z.infer<typeof StanceLabelSchema>;

export const RelevanceSchema = z.enum(["central", "direct", "incidental"]);
export type Relevance = z.infer<typeof RelevanceSchema>;

export const TopicSchema = z.enum([
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
]);
export type Topic = z.infer<typeof TopicSchema>;

export const LabelConfidenceSchema = z.enum(["low", "medium", "high"]);
export type LabelConfidence = z.infer<typeof LabelConfidenceSchema>;

export const EvidenceAnnotationSchema = z.object({
  target: TargetSchema,
  referenceBasis: ReferenceBasisSchema,
  stance: StanceSchema,
  stanceLabel: StanceLabelSchema,
  relevance: RelevanceSchema,
  topic: TopicSchema,
  confidence: LabelConfidenceSchema,
  attributionConfidence: LabelConfidenceSchema,
  rationale: z.string(),
});
export type EvidenceAnnotation = z.infer<typeof EvidenceAnnotationSchema>;

export const EvidenceSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  storyId: z.number(),
  commentId: z.number().optional(),
  hnUrl: z.string(),
  sourceType: z.enum(["title", "comment"]),
  excerpt: z.string(),
  annotations: z.array(EvidenceAnnotationSchema).min(1),
}).superRefine((value, ctx) => {
  const targets = new Set<string>();
  for (const annotation of value.annotations) {
    if (targets.has(annotation.target)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate annotation target ${annotation.target}`,
        path: ["annotations"],
      });
    }
    targets.add(annotation.target);
  }
  if (value.sourceType === "title" && value.commentId !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "title evidence must not include commentId",
      path: ["commentId"],
    });
  }
  if (value.sourceType === "comment" && value.commentId === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "comment evidence must include commentId",
      path: ["commentId"],
    });
  }
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const BucketSchema = z.enum([
  "strongly_negative",
  "negative",
  "mixed_neutral",
  "positive",
  "strongly_positive",
]);
export type Bucket = z.infer<typeof BucketSchema>;

export const DirectionSchema = z.enum(["negative", "neutral", "positive"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const SupportSchema = z.enum(["low", "medium", "high"]);
export type Support = z.infer<typeof SupportSchema>;

export const TargetDailyResultSchema = z.object({
  target: TargetSchema,
  bucket: BucketSchema,
  direction: DirectionSchema,
  support: SupportSchema,
  confidence: LabelConfidenceSchema,
  rawMean: z.number().min(-2).max(2),
  adjustedMean: z.number().min(-2).max(2),
  effectiveSupport: z.number().nonnegative(),
  evidenceBalance: z.object({
    positive: z.number().int().nonnegative(),
    neutral: z.number().int().nonnegative(),
    negative: z.number().int().nonnegative(),
  }),
  displayRank: z.number().int().positive(),
  tiedWith: z.array(TargetSchema),
  rankNote: z.enum(["low_support", "close_tie", "mixed_high_volume"]).optional(),
  evidenceIds: z.array(z.string()),
  summary: z.string(),
});
export type TargetDailyResult = z.infer<typeof TargetDailyResultSchema>;

export const DailyResultSchema = z.object({
  date: z.string(),
  generatedAt: z.string(),
  samplingMethod: SamplingMethodSchema,
  rankingDirection: z.literal("most_negative_to_most_positive"),
  headlineSummary: z.string(),
  primarySignalTarget: TargetSchema.nullable(),
  primarySignalTargets: z.array(TargetSchema),
  primarySignalTie: z.boolean(),
  primarySignalDirection: DirectionSchema,
  hasLowSupportLeader: z.boolean(),
  ranking: z.array(TargetDailyResultSchema),
  unmentioned: z.array(TargetSchema),
  evidence: z.array(EvidenceSchema),
  models: z.record(z.string(), z.string()),
  methodVersion: z.record(z.string(), z.string()),
}).superRefine((value, ctx) => {
  const evidenceById = new Map(value.evidence.map((item) => [item.id, item]));
  const rankedTargets = new Set(value.ranking.map((item) => item.target));
  for (const result of value.ranking) {
    if (result.evidenceIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `ranked target ${result.target} has no evidence`,
        path: ["ranking"],
      });
    }
    for (const id of result.evidenceIds) {
      const evidence = evidenceById.get(id);
      if (!evidence) {
        ctx.addIssue({
          code: "custom",
          message: `ranked target ${result.target} references unknown evidence ${id}`,
          path: ["ranking"],
        });
      } else if (!evidence.annotations.some((annotation) => annotation.target === result.target)) {
        ctx.addIssue({
          code: "custom",
          message: `evidence ${id} does not annotate ${result.target}`,
          path: ["ranking"],
        });
      }
    }
  }
  for (const target of value.unmentioned) {
    if (rankedTargets.has(target)) {
      ctx.addIssue({
        code: "custom",
        message: `target ${target} cannot be both ranked and unmentioned`,
        path: ["unmentioned"],
      });
    }
  }
});
export type DailyResult = z.infer<typeof DailyResultSchema>;

export const SiteIndexSchema = z.object({
  generatedAt: z.string(),
  targets: z.array(TargetSchema),
  days: z.array(DailyResultSchema),
});
export type SiteIndex = z.infer<typeof SiteIndexSchema>;
