import { aggregateDailyEvidence, withDailySummaries } from "./aggregate.js";
import { runDeterministicAudit } from "./audit.js";
import { MODEL_CONFIG, TARGETS, type Target } from "./config.js";
import { dailyPath, pathExists, readJson, readRawDay, readRun, writeDaily, writeRun } from "./io.js";
import { createResponse, OpenAiStatusError, type OpenAiUsage } from "./openai-client.js";
import { dailySummaryRequestBody, evidenceDetectionRequestBody } from "./prompts.js";
import { OUTPUT_TOKEN_CAPS, preflightResponseBody, withResponseSafeguards } from "./token-budget.js";
import {
  DailyResultSchema,
  EvidenceSchema,
  LabelConfidenceSchema,
  ReferenceBasisSchema,
  RelevanceSchema,
  StanceLabelSchema,
  StanceSchema,
  TargetSchema,
  TopicSchema,
  type DailyResult,
  type Evidence,
  type RawDay,
  type ResponseStageInfo,
  type RunFile,
  type RunObservability,
  type SamplingMethod,
} from "./types.js";
import { z } from "zod";

type StageName = "evidenceDetection" | "dailySummary";

const ModelEvidenceSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  storyId: z.number(),
  commentId: z.number().nullable(),
  hnUrl: z.string(),
  sourceType: z.enum(["title", "comment"]),
  excerpt: z.string(),
  annotations: z.array(z.object({
    target: TargetSchema,
    referenceBasis: ReferenceBasisSchema,
    stance: StanceSchema,
    stanceLabel: StanceLabelSchema,
    relevance: RelevanceSchema,
    topic: TopicSchema,
    confidence: LabelConfidenceSchema,
    attributionConfidence: LabelConfidenceSchema,
    rationale: z.string(),
  })).min(1),
}).transform((value) => {
  const { commentId, ...rest } = value;
  return commentId === null ? rest : { ...rest, commentId };
}).pipe(EvidenceSchema);

const EvidenceDetectionOutputSchema = z.object({
  evidence: z.array(ModelEvidenceSchema),
});
type EvidenceDetectionOutput = z.infer<typeof EvidenceDetectionOutputSchema>;

const DailySummaryOutputSchema = z.object({
  headlineSummary: z.string(),
  targetSummaries: z.array(z.object({
    target: TargetSchema,
    summary: z.string(),
  })),
});
type DailySummaryOutput = z.infer<typeof DailySummaryOutputSchema>;

type SourceRecord = {
  text: string;
  hnUrl: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

function citationIds(value: string): string[] {
  return [...value.matchAll(/\[(E\d+)]/g)].map((match) => match[1]).filter((id): id is string => Boolean(id));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function comparableText(value: string): string {
  return normalizeText(value)
    .replaceAll("\u00a0", " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

function stageInfoFromUsage(startedAt: string, usage: OpenAiUsage | undefined): ResponseStageInfo {
  return {
    startedAt,
    completedAt: nowIso(),
    processedCount: 1,
    successCount: 1,
    quarantineCount: 0,
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function inProgressStageInfo(startedAt: string): ResponseStageInfo {
  return {
    startedAt,
    processedCount: 0,
    successCount: 0,
    quarantineCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function failStageInfo(startedAt: string, usage: OpenAiUsage | undefined): ResponseStageInfo {
  return {
    startedAt,
    completedAt: nowIso(),
    processedCount: 1,
    successCount: 0,
    quarantineCount: 1,
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function mergeUsage(left: OpenAiUsage | undefined, right: OpenAiUsage | undefined): OpenAiUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    input_tokens: (left.input_tokens ?? 0) + (right.input_tokens ?? 0),
    input_tokens_details: {
      cached_tokens: (left.input_tokens_details?.cached_tokens ?? 0) + (right.input_tokens_details?.cached_tokens ?? 0),
    },
    output_tokens: (left.output_tokens ?? 0) + (right.output_tokens ?? 0),
    total_tokens: (left.total_tokens ?? 0) + (right.total_tokens ?? 0),
  };
}

function isRetryableOpenAiError(error: unknown): error is OpenAiStatusError {
  return error instanceof OpenAiStatusError && (error.status === 429 || error.status >= 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stanceLabelFor(stance: number): string {
  if (stance === -2) return "strong_negative";
  if (stance === -1) return "negative";
  if (stance === 0) return "neutral_mixed";
  if (stance === 1) return "positive";
  if (stance === 2) return "strong_positive";
  throw new Error(`Invalid stance ${stance}`);
}

function sourceKey(sourceType: "title" | "comment", storyId: number, commentId?: number): string {
  return `${sourceType}:${storyId}:${commentId ?? ""}`;
}

function sourceRecords(day: RawDay): Map<string, SourceRecord> {
  const records = new Map<string, SourceRecord>();
  for (const story of day.items) {
    records.set(sourceKey("title", story.id), {
      text: story.title,
      hnUrl: story.sourceUrl,
    });
    for (const comment of story.topComments) {
      records.set(sourceKey("comment", story.id, comment.id), {
        text: comment.text,
        hnUrl: comment.sourceUrl,
      });
    }
  }
  return records;
}

function validateEvidenceText(day: RawDay, evidence: Evidence[]): Evidence[] {
  const records = sourceRecords(day);
  const seenIds = new Set<string>();
  return evidence.map((item) => {
    if (seenIds.has(item.id)) throw new Error(`Model returned duplicate evidence id ${item.id}`);
    seenIds.add(item.id);

    const record = records.get(sourceKey(item.sourceType, item.storyId, item.commentId));
    if (!record) {
      throw new Error(`Model returned evidence ${item.id} for an unknown ${item.sourceType} source`);
    }

    const excerpt = normalizeText(item.excerpt);
    if (!excerpt) throw new Error(`Model returned empty excerpt for ${item.id}`);
    if (!comparableText(record.text).includes(comparableText(excerpt))) {
      throw new Error(`Model excerpt for ${item.id} is not a substring of the source text`);
    }

    for (const annotation of item.annotations) {
      if (annotation.stanceLabel !== stanceLabelFor(annotation.stance)) {
        throw new Error(`Model returned stanceLabel ${annotation.stanceLabel} for stance ${annotation.stance} in ${item.id}`);
      }
      if (!normalizeText(annotation.rationale)) {
        throw new Error(`Model returned empty rationale in ${item.id}`);
      }
    }

    return {
      ...item,
      hnUrl: record.hnUrl,
      excerpt,
      annotations: item.annotations.map((annotation) => ({
        ...annotation,
        rationale: normalizeText(annotation.rationale),
      })),
    };
  });
}

function observabilityFor(day: RawDay, evidence: Evidence[]): RunObservability {
  const audit = runDeterministicAudit(day, evidence);
  const annotations = evidence.flatMap((item) => item.annotations);
  const annotationsByTarget = Object.fromEntries(TARGETS.map((target) => [
    target,
    annotations.filter((annotation) => annotation.target === target).length,
  ])) as Record<Target, number>;
  const annotationsByReferenceBasis: Record<string, number> = {};
  for (const annotation of annotations) {
    annotationsByReferenceBasis[annotation.referenceBasis] = (annotationsByReferenceBasis[annotation.referenceBasis] ?? 0) + 1;
  }
  return {
    evidenceRecords: evidence.length,
    annotations: annotations.length,
    annotationsByTarget,
    annotationsByReferenceBasis,
    deterministicAuditHits: audit.hits.length,
    deterministicAuditMisses: audit.missed.length,
    deterministicAuditMissSamples: audit.missed.slice(0, 25),
  };
}

async function callStructuredOutput<T>(
  options: {
    stage: StageName;
    body: unknown;
    model: string;
    caps: readonly number[];
    schema: z.ZodType<T>;
  },
): Promise<{ output: T; usage: OpenAiUsage | undefined }> {
  let attempt = 0;
  let validationRetried = false;
  let rateAttempt = 0;

  while (true) {
    const cap = options.caps[Math.min(attempt, options.caps.length - 1)] ?? options.caps[options.caps.length - 1];
    if (cap === undefined) throw new Error(`No output token cap configured for ${options.stage}`);
    const body = withResponseSafeguards(options.body as Record<string, unknown>, cap);
    const preflight = preflightResponseBody(body, options.model, cap);
    if (!preflight.ok) throw new Error(`${options.stage} request failed token preflight: ${preflight.reason}`);

    try {
      const response = await createResponse(body);
      if (response.status === "incomplete" && response.incompleteReason === "max_output_tokens" && attempt === 0) {
        attempt += 1;
        continue;
      }
      if (response.status === "incomplete") {
        throw new Error(response.incompleteReason ?? "response_incomplete");
      }
      return {
        output: options.schema.parse(parseModelJson(response.text)),
        usage: response.usage,
      };
    } catch (error) {
      if (isRetryableOpenAiError(error) && rateAttempt < 3) {
        const retryAfterMs = (error.retryAfter ?? 0) * 1000;
        await sleep(Math.max(retryAfterMs, 2 ** rateAttempt * 1000));
        rateAttempt += 1;
        continue;
      }
      if (!(error instanceof OpenAiStatusError) && !validationRetried) {
        validationRetried = true;
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function callEvidenceDetection(day: RawDay): Promise<{ output: EvidenceDetectionOutput; usage: OpenAiUsage | undefined }> {
  return callStructuredOutput({
    stage: "evidenceDetection",
    body: evidenceDetectionRequestBody(day),
    model: MODEL_CONFIG.evidenceDetection.model,
    caps: [OUTPUT_TOKEN_CAPS.evidenceDetection, OUTPUT_TOKEN_CAPS.evidenceDetectionRetry],
    schema: EvidenceDetectionOutputSchema,
  });
}

async function callDailySummary(result: DailyResult): Promise<{ output: DailySummaryOutput; usage: OpenAiUsage | undefined }> {
  return callStructuredOutput({
    stage: "dailySummary",
    body: dailySummaryRequestBody(result),
    model: MODEL_CONFIG.dailySummary.model,
    caps: [OUTPUT_TOKEN_CAPS.dailySummary, OUTPUT_TOKEN_CAPS.dailySummaryRetry],
    schema: DailySummaryOutputSchema,
  });
}

function validateSummary(result: DailyResult, output: DailySummaryOutput): DailySummaryOutput {
  const rankedTargets = new Set(result.ranking.map((item) => item.target));
  const evidenceIds = new Set(result.evidence.map((item) => item.id));
  const seenTargets = new Set<Target>();
  if (/https?:\/\//i.test(output.headlineSummary)) {
    throw new Error("Daily summary included a raw URL; expected [E#] citations.");
  }
  for (const id of citationIds(output.headlineSummary)) {
    if (!evidenceIds.has(id)) throw new Error(`Daily headline cited unknown evidence id ${id}`);
  }
  if (result.evidence.length > 0 && citationIds(output.headlineSummary).length === 0) {
    throw new Error("Daily headline must cite approved evidence.");
  }

  for (const item of output.targetSummaries) {
    if (seenTargets.has(item.target)) throw new Error(`Daily summary returned duplicate target ${item.target}`);
    seenTargets.add(item.target);
    if (!rankedTargets.has(item.target)) throw new Error(`Daily summary returned unranked target ${item.target}`);
    if (/https?:\/\//i.test(item.summary)) {
      throw new Error(`Daily summary for ${item.target} included a raw URL; expected [E#] citations.`);
    }
    const ranking = result.ranking.find((row) => row.target === item.target);
    const allowed = new Set(ranking?.evidenceIds ?? []);
    const cited = citationIds(item.summary);
    if (cited.length === 0) throw new Error(`Daily summary for ${item.target} must cite approved evidence.`);
    for (const id of cited) {
      if (!allowed.has(id)) throw new Error(`Daily summary for ${item.target} cited evidence ${id} not attached to that target`);
    }
  }
  for (const target of rankedTargets) {
    if (!seenTargets.has(target)) throw new Error(`Daily summary omitted ranked target ${target}`);
  }
  return {
    headlineSummary: normalizeText(output.headlineSummary),
    targetSummaries: output.targetSummaries.map((item) => ({
      target: item.target,
      summary: normalizeText(item.summary),
    })),
  };
}

async function failRun(date: string, stage: StageName, startedAt: string, error: unknown, usage?: OpenAiUsage): Promise<void> {
  const run = await readRun(date);
  await writeRun({
    ...run,
    state: "failed",
    responses: {
      ...run.responses,
      [stage]: failStageInfo(startedAt, usage),
    },
    error: error instanceof Error ? error.message : String(error),
  });
}

export async function createFetchedRun(date: string, samplingMethod: SamplingMethod): Promise<void> {
  const createdAt = nowIso();
  await writeRun({
    date,
    samplingMethod,
    state: "fetched",
    createdAt,
    updatedAt: createdAt,
    responses: {},
  });
}

export async function markSkippedRun(date: string, samplingMethod: SamplingMethod, reason: string): Promise<void> {
  const createdAt = nowIso();
  await writeRun({
    date,
    samplingMethod,
    state: "skipped",
    createdAt,
    updatedAt: createdAt,
    responses: {},
    error: reason,
  });
}

export async function analyzeDay(date: string, options: { force?: boolean } = {}): Promise<RunFile> {
  let run = await readRun(date);
  if (run.state === "complete" && !options.force) return run;
  if ((run.state === "failed" || run.state === "skipped") && !options.force) return run;
  if (options.force || run.state === "complete" || run.state === "failed" || run.state === "skipped") {
    const { error: _error, observability: _observability, ...cleanRun } = run;
    await writeRun({ ...cleanRun, state: "fetched", responses: {} });
    run = await readRun(date);
  }

  const raw = await readRawDay(date);
  let stage: StageName = "evidenceDetection";
  let startedAt = nowIso();
  let usage: OpenAiUsage | undefined;
  try {
    await writeRun({
      ...run,
      state: "analysis_processing",
      responses: {
        evidenceDetection: inProgressStageInfo(startedAt),
      },
    });

    let evidence: Evidence[] | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const evidenceResult = await callEvidenceDetection(raw);
      usage = mergeUsage(usage, evidenceResult.usage);
      try {
        evidence = validateEvidenceText(raw, evidenceResult.output.evidence);
        break;
      } catch (error) {
        if (attempt < 2) continue;
        throw error;
      }
    }
    if (!evidence) throw new Error("Evidence validation did not produce accepted evidence");
    const observability = observabilityFor(raw, evidence);
    const aggregated = aggregateDailyEvidence({
      date: raw.date,
      generatedAt: nowIso(),
      evidence,
      models: {
        evidenceDetection: MODEL_CONFIG.evidenceDetection.model,
        dailySummary: MODEL_CONFIG.dailySummary.model,
      },
    });

    await writeRun({
      ...(await readRun(date)),
      state: "analysis_processing",
      responses: {
        evidenceDetection: stageInfoFromUsage(startedAt, usage),
      },
      observability,
    });

    stage = "dailySummary";
    startedAt = nowIso();
    usage = undefined;
    const runBeforeSummary = await readRun(date);
    await writeRun({
      ...runBeforeSummary,
      state: "analysis_processing",
      responses: {
        ...runBeforeSummary.responses,
        dailySummary: inProgressStageInfo(startedAt),
      },
    });

    let summaries: DailySummaryOutput | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const summaryResult = await callDailySummary(aggregated);
      usage = mergeUsage(usage, summaryResult.usage);
      try {
        summaries = validateSummary(aggregated, summaryResult.output);
        break;
      } catch (error) {
        if (attempt < 2) continue;
        throw error;
      }
    }
    if (!summaries) throw new Error("Daily summary validation did not produce summaries");
    const daily = DailyResultSchema.parse(withDailySummaries(aggregated, summaries));
    await writeDaily(daily);
    const finalRun = await readRun(date);
    const { error: _error, ...runWithoutError } = finalRun;
    await writeRun({
      ...runWithoutError,
      state: "complete",
      responses: {
        ...finalRun.responses,
        dailySummary: stageInfoFromUsage(startedAt, usage),
      },
      observability,
    });
    return await readRun(date);
  } catch (error) {
    await failRun(date, stage, startedAt, error, usage);
    throw error;
  }
}

export async function hasDailyResult(date: string): Promise<boolean> {
  if (!(await pathExists(dailyPath(date)))) return false;
  try {
    await readJson(dailyPath(date), DailyResultSchema);
    return true;
  } catch {
    return false;
  }
}
