import { MODEL_CONFIG, METHOD_VERSION, TARGET_LABELS, TARGETS, type Target } from "./config.js";
import { dailyPath, pathExists, readRawDay, readRun, writeDaily, writeRun } from "./io.js";
import { createResponse, OpenAiStatusError, type OpenAiUsage } from "./openai-client.js";
import { titleAnalysisRequestBody } from "./prompts.js";
import { OUTPUT_TOKEN_CAPS, preflightResponseBody, withResponseSafeguards } from "./token-budget.js";
import {
  DailyResultSchema,
  EvidenceSchema,
  type DailyEntity,
  type Evidence,
  type RawDay,
  type ResponseStageInfo,
  type RunFile,
  type SamplingMethod,
} from "./types.js";
import { z } from "zod";

const CLOSE_CALL_MARGIN = 0.1;
const SCORE_EPSILON = 0.000001;

const ModelDailyEntitySchema = z.object({
  score: z.number().min(-1).max(1).nullable(),
  mentionCount: z.number().int().nonnegative(),
  positiveCount: z.number().int().nonnegative(),
  neutralCount: z.number().int().nonnegative(),
  negativeCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  judgementSnippet: z.string(),
  evidenceIds: z.array(z.string()),
});

const TitleAnalysisOutputSchema = z.object({
  winner: z.enum(TARGETS).nullable(),
  dailyJudgementSnippet: z.string(),
  winnerExplanation: z.string(),
  entities: z.object({
    openai: ModelDailyEntitySchema,
    anthropic: ModelDailyEntitySchema,
    google_gemini: ModelDailyEntitySchema,
    microsoft_copilot: ModelDailyEntitySchema,
  }),
  evidence: z.array(EvidenceSchema),
});

type TitleAnalysisOutput = z.infer<typeof TitleAnalysisOutputSchema>;
type ModelDailyEntity = z.infer<typeof ModelDailyEntitySchema>;
type NormalizedDailyOutput = {
  winner: Target | null;
  dailyJudgementSnippet: string;
  winnerExplanation: string;
  entities: Record<Target, DailyEntity>;
  evidence: Evidence[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyEntity(snippet = ""): DailyEntity {
  return {
    score: null,
    rawWeightedSentiment: null,
    mentionCount: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    confidence: 0,
    judgementSnippet: snippet,
    evidenceIds: [],
  };
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

function isRetryableOpenAiError(error: unknown): error is OpenAiStatusError {
  return error instanceof OpenAiStatusError && (error.status === 429 || error.status >= 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateEvidence(day: RawDay, output: TitleAnalysisOutput): void {
  const validItemIds = new Set(day.items.map((item) => item.id));
  const seenEvidenceIds = new Set<string>();
  for (const evidence of output.evidence) {
    if (!validItemIds.has(evidence.hnItemId)) {
      throw new Error(`Model returned evidence for unknown HN item ${evidence.hnItemId}`);
    }
    if (seenEvidenceIds.has(evidence.id)) {
      throw new Error(`Model returned duplicate evidence id ${evidence.id}`);
    }
    seenEvidenceIds.add(evidence.id);
  }

  const snippets = [
    output.dailyJudgementSnippet,
    output.winnerExplanation,
    ...TARGETS.map((target) => output.entities[target].judgementSnippet),
  ];
  for (const snippet of snippets) {
    if (/https?:\/\//i.test(snippet)) {
      throw new Error("Model snippet included a raw URL; expected [E#] evidence citations.");
    }
    for (const id of citationIds(snippet)) {
      if (!seenEvidenceIds.has(id)) throw new Error(`Model snippet cited unknown evidence id ${id}`);
    }
  }
}

function validateEntityText(target: Target, entity: DailyEntity): void {
  if (entity.score === null) return;
  for (const id of citationIds(entity.judgementSnippet)) {
    if (!entity.evidenceIds.includes(id)) {
      throw new Error(`Model cited ${id} in ${target} snippet without attaching it to that provider`);
    }
  }
  const text = entity.judgementSnippet.toLowerCase();
  const positiveSummary = /\b(slightly positive overall|mostly positive|net positive|overall positive|positive overall|clearly positive|strongly positive)\b/;
  const negativeSummary = /\b(slightly negative overall|mostly negative|net negative|overall negative|negative overall|clearly negative|strongly negative)\b/;
  if (entity.score <= -0.1 && positiveSummary.test(text)) {
    throw new Error(`Model returned positive summary language for negative ${target} score`);
  }
  if (entity.score >= 0.1 && negativeSummary.test(text)) {
    throw new Error(`Model returned negative summary language for positive ${target} score`);
  }
  if (Math.abs(entity.score) < 0.1 && (positiveSummary.test(text) || negativeSummary.test(text))) {
    throw new Error(`Model returned directional summary language for neutral ${target} score`);
  }
}

function normalizeEntity(target: Target, entity: ModelDailyEntity, evidenceById: Map<string, Evidence>): DailyEntity {
  const judgementSnippet = normalizeText(entity.judgementSnippet);
  const evidenceIds = entity.evidenceIds.map((id) => id.trim()).filter(Boolean);
  const uniqueEvidenceIds = new Set<string>();

  for (const id of evidenceIds) {
    if (uniqueEvidenceIds.has(id)) throw new Error(`Model returned duplicate evidence id ${id} for ${target}`);
    uniqueEvidenceIds.add(id);
    const evidence = evidenceById.get(id);
    if (!evidence) throw new Error(`Model returned unknown evidence id ${id} for ${target}`);
    if (evidence.entity !== target) {
      throw new Error(`Model attached evidence id ${id} for ${evidence.entity} to ${target}`);
    }
  }

  const countSum = entity.positiveCount + entity.neutralCount + entity.negativeCount;
  if (countSum !== entity.mentionCount) {
    throw new Error(`Model returned ${target} counts that do not sum to mentionCount`);
  }

  if (entity.score === null) {
    if (
      entity.mentionCount !== 0 ||
      countSum !== 0 ||
      entity.confidence !== 0 ||
      evidenceIds.length !== 0 ||
      judgementSnippet !== "N/A"
    ) {
      throw new Error(`Model returned inconsistent N/A fields for ${target}`);
    }
    return emptyEntity("N/A");
  }

  if (entity.mentionCount === 0) throw new Error(`Model returned score for ${target} without relevant stories`);
  if (entity.confidence === 0) throw new Error(`Model returned score for ${target} with zero confidence`);
  if (evidenceIds.length === 0) throw new Error(`Model returned score for ${target} without evidence ids`);

  const dailyEntity: DailyEntity = {
    score: entity.score,
    rawWeightedSentiment: entity.score,
    mentionCount: entity.mentionCount,
    positiveCount: entity.positiveCount,
    neutralCount: entity.neutralCount,
    negativeCount: entity.negativeCount,
    confidence: entity.confidence,
    judgementSnippet,
    evidenceIds,
  };
  validateEntityText(target, dailyEntity);
  return dailyEntity;
}

function validateWinner(entities: Record<Target, DailyEntity>, winner: Target | null): { margin: number | null } {
  const ranked = TARGETS
    .flatMap((target) => {
      const score = entities[target].score;
      return score === null ? [] : [{ target, score }];
    })
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    if (winner !== null) throw new Error(`Model returned winner ${winner} but no provider had a score`);
    return { margin: null };
  }
  if (winner === null) throw new Error("Model returned null winner despite scored providers");

  const topScore = ranked[0]?.score;
  const winnerScore = entities[winner].score;
  if (topScore === undefined || winnerScore === null) {
    throw new Error(`Model returned winner ${winner} without a score`);
  }
  if (Math.abs(winnerScore - topScore) > SCORE_EPSILON) {
    throw new Error(`Model winner ${winner} does not match top score`);
  }

  const runnerUp = ranked.find((item) => item.target !== winner);
  return { margin: runnerUp ? winnerScore - runnerUp.score : null };
}

function validateWinnerText(output: NormalizedDailyOutput): void {
  const snippets = [
    ["dailyJudgementSnippet", output.dailyJudgementSnippet],
    ["winnerExplanation", output.winnerExplanation],
  ] as const;
  const expectedPrefix = output.winner === null ? "n/a" : TARGET_LABELS[output.winner].toLowerCase();
  for (const [field, value] of snippets) {
    if (!value.toLowerCase().startsWith(expectedPrefix)) {
      throw new Error(`Model ${field} does not start with ${output.winner === null ? "N/A" : TARGET_LABELS[output.winner]}`);
    }
  }
}

function validateEvidenceCoverage(output: NormalizedDailyOutput): void {
  const referencedEvidenceIds = new Set(TARGETS.flatMap((target) => output.entities[target].evidenceIds));
  for (const evidence of output.evidence) {
    if (!referencedEvidenceIds.has(evidence.id)) {
      throw new Error(`Model returned unused evidence id ${evidence.id}`);
    }
  }
}

function normalizeOutput(day: RawDay, output: TitleAnalysisOutput): NormalizedDailyOutput {
  validateEvidence(day, output);
  const itemsById = new Map(day.items.map((item) => [item.id, item]));
  const evidence = output.evidence.map((item) => {
    const sourceUrl = itemsById.get(item.hnItemId)?.sourceUrl ?? item.url;
    return {
      ...item,
      url: sourceUrl,
      summary: normalizeText(item.summary),
    };
  });
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const entities = Object.fromEntries(
    TARGETS.map((target) => [target, normalizeEntity(target, output.entities[target], evidenceById)]),
  ) as Record<Target, DailyEntity>;
  const normalized: NormalizedDailyOutput = {
    winner: output.winner,
    dailyJudgementSnippet: normalizeText(output.dailyJudgementSnippet),
    winnerExplanation: normalizeText(output.winnerExplanation),
    entities,
    evidence,
  };
  validateWinner(entities, output.winner);
  validateWinnerText(normalized);
  validateEvidenceCoverage(normalized);
  return {
    ...normalized,
  };
}

async function callTitleAnalysis(day: RawDay): Promise<{ output: TitleAnalysisOutput; usage: OpenAiUsage | undefined }> {
  const caps = [OUTPUT_TOKEN_CAPS.titleAnalysis, OUTPUT_TOKEN_CAPS.titleAnalysisRetry];
  let attempt = 0;
  let validationRetried = false;
  let rateAttempt = 0;

  while (true) {
    const cap = caps[Math.min(attempt, caps.length - 1)] ?? OUTPUT_TOKEN_CAPS.titleAnalysisRetry;
    const body = withResponseSafeguards(titleAnalysisRequestBody(day) as Record<string, unknown>, cap);
    const preflight = preflightResponseBody(body, MODEL_CONFIG.titleAnalysis.model, cap);
    if (!preflight.ok) throw new Error(`Title analysis request failed token preflight: ${preflight.reason}`);

    try {
      const response = await createResponse(body);
      if (response.status === "incomplete" && response.incompleteReason === "max_output_tokens" && attempt === 0) {
        attempt += 1;
        continue;
      }
      if (response.status === "incomplete") {
        throw new Error(response.incompleteReason ?? "response_incomplete");
      }
      const output = TitleAnalysisOutputSchema.parse(parseModelJson(response.text));
      return { output, usage: response.usage };
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

function dailyResultFromOutput(day: RawDay, output: TitleAnalysisOutput) {
  const normalized = normalizeOutput(day, output);
  const { margin } = validateWinner(normalized.entities, normalized.winner);
  const winner = normalized.winner;
  const lowConfidence = winner === null || normalized.entities[winner].mentionCount < 2 || normalized.entities[winner].confidence < 0.55;
  const closeCall = margin !== null && margin < CLOSE_CALL_MARGIN;

  return DailyResultSchema.parse({
    date: day.date,
    generatedAt: nowIso(),
    samplingMethod: day.samplingMethod,
    winner,
    dailyJudgementSnippet: normalized.dailyJudgementSnippet,
    winnerExplanation: normalized.winnerExplanation,
    lowConfidence,
    closeCall,
    margin,
    models: {
      titleAnalysis: MODEL_CONFIG.titleAnalysis.model,
    },
    methodVersion: METHOD_VERSION,
    entities: normalized.entities,
    evidence: normalized.evidence,
  });
}

async function failRun(run: RunFile, startedAt: string, error: unknown, usage?: OpenAiUsage): Promise<void> {
  await writeRun({
    ...run,
    state: "failed",
    responses: {
      ...run.responses,
      titleAnalysis: failStageInfo(startedAt, usage),
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

export async function analyzeDay(date: string, options: { force?: boolean } = {}): Promise<RunFile> {
  let run = await readRun(date);
  if (run.state === "complete" && !options.force) return run;
  if (run.state === "failed" && !options.force) return run;
  if (options.force || run.state === "complete" || run.state === "failed") {
    const { error: _error, ...cleanRun } = run;
    await writeRun({ ...cleanRun, state: "fetched", responses: {} });
    run = await readRun(date);
  }

  const startedAt = nowIso();
  await writeRun({
    ...run,
    state: "analysis_processing",
    responses: {
      ...run.responses,
      titleAnalysis: {
        startedAt,
        processedCount: 0,
        successCount: 0,
        quarantineCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    },
  });
  run = await readRun(date);

  let usage: OpenAiUsage | undefined;
  try {
    const raw = await readRawDay(date);
    const result = await callTitleAnalysis(raw);
    usage = result.usage;
    const daily = dailyResultFromOutput(raw, result.output);
    await writeDaily(daily);
    await writeRun({
      ...run,
      state: "complete",
      responses: {
        ...run.responses,
        titleAnalysis: stageInfoFromUsage(startedAt, usage),
      },
    });
    return await readRun(date);
  } catch (error) {
    await failRun(run, startedAt, error, usage);
    throw error;
  }
}

export async function hasDailyResult(date: string): Promise<boolean> {
  return pathExists(dailyPath(date));
}
