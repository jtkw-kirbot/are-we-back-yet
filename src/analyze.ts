import { MODEL_CONFIG, METHOD_VERSION, TARGETS, type Target } from "./config.js";
import { dailyPath, pathExists, readRawDay, readRun, writeDaily, writeRun } from "./io.js";
import { createResponse, OpenAiStatusError, type OpenAiUsage } from "./openai-client.js";
import { titleAnalysisRequestBody } from "./prompts.js";
import { OUTPUT_TOKEN_CAPS, preflightResponseBody, withResponseSafeguards } from "./token-budget.js";
import {
  DailyResultSchema,
  EvidenceSchema,
  TitleAnalysisSchema,
  type DailyEntity,
  type Evidence,
  type RawDay,
  type ResponseStageInfo,
  type RunFile,
  type SamplingMethod,
  type TitleAnalysis,
} from "./types.js";
import { z } from "zod";

const PRIOR_WEIGHT = 3;
const MIN_CONFIDENCE = 0.25;

const TitleAnalysisOutputSchema = z.object({
  winner: z.enum(TARGETS),
  dailyJudgementSnippet: z.string(),
  winnerExplanation: z.string(),
  entityJudgements: z.object({
    openai: z.string(),
    anthropic: z.string(),
    google_gemini: z.string(),
    microsoft_copilot: z.string(),
  }),
  analyses: z.array(TitleAnalysisSchema),
  evidence: z.array(EvidenceSchema),
});

type TitleAnalysisOutput = z.infer<typeof TitleAnalysisOutputSchema>;

type EntityAccumulator = {
  sentimentSum: number;
  weightSum: number;
  confidenceSum: number;
  mentionCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyAccumulator(): EntityAccumulator {
  return {
    sentimentSum: 0,
    weightSum: 0,
    confidenceSum: 0,
    mentionCount: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
  };
}

function emptyEntity(snippet = ""): DailyEntity {
  return {
    score: 0,
    rawWeightedSentiment: 0,
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

function rankWeight(rank: number): number {
  return Math.max(0.7, 1.25 - (rank - 1) * 0.02);
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
    ...TARGETS.map((target) => output.entityJudgements[target]),
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

function normalizeOutput(day: RawDay, output: TitleAnalysisOutput): TitleAnalysisOutput {
  validateEvidence(day, output);
  const itemsById = new Map(day.items.map((item) => [item.id, item]));
  return {
    winner: output.winner,
    dailyJudgementSnippet: normalizeText(output.dailyJudgementSnippet),
    winnerExplanation: normalizeText(output.winnerExplanation),
    entityJudgements: {
      openai: normalizeText(output.entityJudgements.openai),
      anthropic: normalizeText(output.entityJudgements.anthropic),
      google_gemini: normalizeText(output.entityJudgements.google_gemini),
      microsoft_copilot: normalizeText(output.entityJudgements.microsoft_copilot),
    },
    analyses: output.analyses,
    evidence: output.evidence.map((item) => {
      const sourceUrl = itemsById.get(item.hnItemId)?.sourceUrl ?? item.url;
      return {
        ...item,
        url: sourceUrl,
        summary: normalizeText(item.summary),
      };
    }),
  };
}

function accumulatorsFromAnalyses(day: RawDay, analyses: TitleAnalysis[]): Record<Target, EntityAccumulator> {
  const itemsById = new Map(day.items.map((item) => [item.id, item]));
  const accumulators: Record<Target, EntityAccumulator> = {
    openai: emptyAccumulator(),
    anthropic: emptyAccumulator(),
    google_gemini: emptyAccumulator(),
    microsoft_copilot: emptyAccumulator(),
  };

  for (const analysis of analyses) {
    if (!analysis.relevance || analysis.confidence < MIN_CONFIDENCE) continue;
    const item = itemsById.get(analysis.itemId);
    if (!item) continue;
    const normalizedSentiment = analysis.sentiment / 2;
    const weight = analysis.confidence * rankWeight(item.rank);
    const accumulator = accumulators[analysis.target];
    accumulator.sentimentSum += normalizedSentiment * weight;
    accumulator.weightSum += weight;
    accumulator.confidenceSum += analysis.confidence;
    accumulator.mentionCount += 1;
    if (analysis.sentiment > 0) accumulator.positiveCount += 1;
    else if (analysis.sentiment < 0) accumulator.negativeCount += 1;
    else accumulator.neutralCount += 1;
  }

  return accumulators;
}

function buildEntities(
  accumulators: Record<Target, EntityAccumulator>,
  snippets: Record<Target, string>,
  evidence: Evidence[],
): Record<Target, DailyEntity> {
  const entities: Record<Target, DailyEntity> = {
    openai: emptyEntity(snippets.openai),
    anthropic: emptyEntity(snippets.anthropic),
    google_gemini: emptyEntity(snippets.google_gemini),
    microsoft_copilot: emptyEntity(snippets.microsoft_copilot),
  };

  for (const target of TARGETS) {
    const accumulator = accumulators[target];
    const rawWeightedSentiment = accumulator.weightSum === 0
      ? 0
      : accumulator.sentimentSum / accumulator.weightSum;
    entities[target] = {
      score: accumulator.sentimentSum / (accumulator.weightSum + PRIOR_WEIGHT),
      rawWeightedSentiment,
      mentionCount: accumulator.mentionCount,
      positiveCount: accumulator.positiveCount,
      neutralCount: accumulator.neutralCount,
      negativeCount: accumulator.negativeCount,
      confidence: accumulator.mentionCount === 0 ? 0 : accumulator.confidenceSum / accumulator.mentionCount,
      judgementSnippet: snippets[target],
      evidenceIds: evidence.filter((item) => item.entity === target).map((item) => item.id),
    };
  }

  return entities;
}

function winnerFromEntities(entities: Record<Target, DailyEntity>, proposedWinner: Target): {
  winner: Target;
  margin: number;
} {
  const ordered = TARGETS
    .map((target) => ({ target, score: entities[target].score }))
    .sort((a, b) => b.score - a.score);
  const top = ordered[0] ?? { target: proposedWinner, score: 0 };
  const runnerUp = ordered[1] ?? { target: proposedWinner, score: 0 };
  const allTied = ordered.every((item) => Math.abs(item.score - top.score) < 0.000001);
  return {
    winner: allTied ? proposedWinner : top.target,
    margin: top.score - runnerUp.score,
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
  const accumulators = accumulatorsFromAnalyses(day, normalized.analyses);
  const entities = buildEntities(accumulators, normalized.entityJudgements, normalized.evidence);
  const { winner, margin } = winnerFromEntities(entities, normalized.winner);
  const lowConfidence = entities[winner].mentionCount < 2 || entities[winner].confidence < 0.55;
  const closeCall = margin < 0.05;

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
    entities,
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
