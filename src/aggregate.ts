import { MODEL_CONFIG, METHOD_VERSION, TARGET_LABELS, TARGETS, type Target } from "./config.js";
import { readJson, readRawDay, readRun, responseDir, writeDaily, writeRun } from "./io.js";
import { createResponse } from "./openai-client.js";
import { adjudicationInput, adjudicationJsonSchema, jsonSchemaFormat } from "./prompts.js";
import { OUTPUT_TOKEN_CAPS, preflightResponseBody, withResponseSafeguards } from "./token-budget.js";
import {
  DailyResultSchema,
  SentimentResultSchema,
  type DailyEntity,
  type DailyResult,
  type Evidence,
  type HnItem,
  type SentimentAnalysis,
  type SentimentResult,
} from "./types.js";
import { z } from "zod";
import path from "node:path";

const PRIOR_WEIGHT = 10;

const AdjudicationOutputSchema = z.object({
  winner: z.enum(TARGETS),
  dailyJudgementSnippet: z.string(),
  winnerExplanation: z.string(),
  entityJudgements: z.object({
    openai: z.string(),
    anthropic: z.string(),
    google_gemini: z.string(),
    microsoft_copilot: z.string(),
  }),
});

type EntityAccumulator = {
  sentimentSum: number;
  weightSum: number;
  confidenceSum: number;
  mentionCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  candidates: Array<{
    item: HnItem;
    analysis: SentimentAnalysis;
    strength: number;
  }>;
};

function emptyAccumulator(): EntityAccumulator {
  return {
    sentimentSum: 0,
    weightSum: 0,
    confidenceSum: 0,
    mentionCount: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    candidates: [],
  };
}

function itemWeight(item: HnItem): number {
  if (item.depth === 0) return 2.0;
  if (item.depth === 1) return 1.0;
  if (item.depth === 2) return 0.7;
  return 0.5;
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

function citationIds(value: string): string[] {
  return [...value.matchAll(/\[(E\d+)]/g)].map((match) => match[1]).filter((id): id is string => Boolean(id));
}

function validateCitations(snippets: string[], evidence: Evidence[]): void {
  const known = new Set(evidence.map((item) => item.id));
  for (const snippet of snippets) {
    if (/https?:\/\//i.test(snippet)) {
      throw new Error("Adjudication snippet included a raw URL; expected citation tokens.");
    }
    for (const id of citationIds(snippet)) {
      if (!known.has(id)) throw new Error(`Adjudication snippet cited unknown evidence id ${id}.`);
    }
  }
}

function normalizeAdjudication(output: z.infer<typeof AdjudicationOutputSchema>): z.infer<typeof AdjudicationOutputSchema> {
  return {
    winner: output.winner,
    dailyJudgementSnippet: output.dailyJudgementSnippet.replace(/\s+/g, " ").trim(),
    winnerExplanation: output.winnerExplanation.replace(/\s+/g, " ").trim(),
    entityJudgements: {
      openai: output.entityJudgements.openai.replace(/\s+/g, " ").trim(),
      anthropic: output.entityJudgements.anthropic.replace(/\s+/g, " ").trim(),
      google_gemini: output.entityJudgements.google_gemini.replace(/\s+/g, " ").trim(),
      microsoft_copilot: output.entityJudgements.microsoft_copilot.replace(/\s+/g, " ").trim(),
    },
  };
}

function buildEvidence(accumulators: Record<Target, EntityAccumulator>): Evidence[] {
  const evidence: Evidence[] = [];
  let id = 1;
  for (const target of TARGETS) {
    const candidates = accumulators[target].candidates
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4);
    for (const candidate of candidates) {
      const role = candidate.analysis.sentiment > 0
        ? "positive_driver"
        : candidate.analysis.sentiment < 0
          ? "negative_driver"
          : "neutral_context";
      evidence.push({
        id: `E${id}`,
        entity: target,
        hnItemId: candidate.item.id,
        url: candidate.item.sourceUrl,
        role,
        summary: candidate.analysis.evidenceSummary,
      });
      id += 1;
    }
  }
  return evidence;
}

function aggregateEntities(
  rawItems: HnItem[],
  sentiments: SentimentResult[],
  snippets: Record<Target, string>,
  evidence: Evidence[],
): Record<Target, DailyEntity> {
  const itemById = new Map(rawItems.map((item) => [item.id, item]));
  const accumulators: Record<Target, EntityAccumulator> = {
    openai: emptyAccumulator(),
    anthropic: emptyAccumulator(),
    google_gemini: emptyAccumulator(),
    microsoft_copilot: emptyAccumulator(),
  };

  for (const result of sentiments) {
    const item = itemById.get(result.itemId);
    if (!item) continue;
    const baseWeight = itemWeight(item);
    for (const analysis of result.analyses) {
      if (!analysis.relevance) continue;
      const weight = baseWeight * analysis.confidence;
      const accumulator = accumulators[analysis.target];
      accumulator.sentimentSum += analysis.sentiment * weight;
      accumulator.weightSum += weight;
      accumulator.confidenceSum += analysis.confidence;
      accumulator.mentionCount += 1;
      if (analysis.sentiment > 0) accumulator.positiveCount += 1;
      else if (analysis.sentiment < 0) accumulator.negativeCount += 1;
      else accumulator.neutralCount += 1;
      accumulator.candidates.push({
        item,
        analysis,
        strength: Math.abs(analysis.sentiment) * weight,
      });
    }
  }

  const byTarget: Record<Target, DailyEntity> = {
    openai: emptyEntity(),
    anthropic: emptyEntity(),
    google_gemini: emptyEntity(),
    microsoft_copilot: emptyEntity(),
  };

  for (const target of TARGETS) {
    const accumulator = accumulators[target];
    const rawWeightedSentiment = accumulator.weightSum === 0
      ? 0
      : accumulator.sentimentSum / accumulator.weightSum;
    const score = accumulator.sentimentSum / (accumulator.weightSum + PRIOR_WEIGHT);
    byTarget[target] = {
      score,
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

  return byTarget;
}

function emptyEntity(): DailyEntity {
  return {
    score: 0,
    rawWeightedSentiment: 0,
    mentionCount: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    confidence: 0,
    judgementSnippet: "",
    evidenceIds: [],
  };
}

function prelimAggregation(rawItems: HnItem[], sentiments: SentimentResult[]) {
  const itemById = new Map(rawItems.map((item) => [item.id, item]));
  const accumulators: Record<Target, EntityAccumulator> = {
    openai: emptyAccumulator(),
    anthropic: emptyAccumulator(),
    google_gemini: emptyAccumulator(),
    microsoft_copilot: emptyAccumulator(),
  };

  for (const result of sentiments) {
    const item = itemById.get(result.itemId);
    if (!item) continue;
    const baseWeight = itemWeight(item);
    for (const analysis of result.analyses) {
      if (!analysis.relevance) continue;
      const weight = baseWeight * analysis.confidence;
      const accumulator = accumulators[analysis.target];
      accumulator.sentimentSum += analysis.sentiment * weight;
      accumulator.weightSum += weight;
      accumulator.confidenceSum += analysis.confidence;
      accumulator.mentionCount += 1;
      if (analysis.sentiment > 0) accumulator.positiveCount += 1;
      else if (analysis.sentiment < 0) accumulator.negativeCount += 1;
      else accumulator.neutralCount += 1;
      accumulator.candidates.push({ item, analysis, strength: Math.abs(analysis.sentiment) * weight });
    }
  }

  const scores = Object.fromEntries(TARGETS.map((target) => {
    const accumulator = accumulators[target];
    return [target, {
      score: accumulator.sentimentSum / (accumulator.weightSum + PRIOR_WEIGHT),
      rawWeightedSentiment: accumulator.weightSum === 0 ? 0 : accumulator.sentimentSum / accumulator.weightSum,
      mentionCount: accumulator.mentionCount,
      positiveCount: accumulator.positiveCount,
      neutralCount: accumulator.neutralCount,
      negativeCount: accumulator.negativeCount,
      confidence: accumulator.mentionCount === 0 ? 0 : accumulator.confidenceSum / accumulator.mentionCount,
    }];
  })) as Record<Target, Omit<DailyEntity, "judgementSnippet" | "evidenceIds">>;

  return { accumulators, scores };
}

function winnerFromScores(scores: Record<Target, { score: number }>): { winner: Target; margin: number } {
  const ordered = TARGETS
    .map((target) => ({ target, score: scores[target].score }))
    .sort((a, b) => b.score - a.score);
  const winner = ordered[0]?.target ?? "openai";
  const margin = (ordered[0]?.score ?? 0) - (ordered[1]?.score ?? 0);
  return { winner, margin };
}

export function sentimentResultsPath(date: string): string {
  return path.join(responseDir(date), "sentiment-results.json");
}

export async function writeDailyReport(date: string, options: { force?: boolean } = {}): Promise<boolean> {
  const run = await readRun(date);
  if (run.state !== "sentiment_complete" && !(options.force && run.state === "complete")) return false;

  const raw = await readRawDay(date);
  const sentiments = await readJson(sentimentResultsPath(date), SentimentResultSchema.array());
  const { accumulators, scores } = prelimAggregation(raw.items, sentiments);
  const evidence = buildEvidence(accumulators);
  const { winner: preliminaryWinner, margin } = winnerFromScores(scores);
  const lowConfidence = TARGETS.some((target) => scores[target].mentionCount > 0) &&
    scores[preliminaryWinner].mentionCount < 10;
  const closeCall = margin < 0.05;

  const adjudicationPayload = {
    date,
    samplingMethod: raw.samplingMethod,
    targetLabels: TARGET_LABELS,
    preliminaryWinner,
    lowConfidence,
    closeCall,
    margin,
    scores,
    evidence,
  };
  const adjudicationBody = withResponseSafeguards({
    model: MODEL_CONFIG.adjudication.model,
    reasoning: { effort: MODEL_CONFIG.adjudication.reasoningEffort },
    input: adjudicationInput(adjudicationPayload),
    text: { format: jsonSchemaFormat("daily_adjudication", adjudicationJsonSchema) },
  }, OUTPUT_TOKEN_CAPS.adjudication);
  const preflight = preflightResponseBody(adjudicationBody, MODEL_CONFIG.adjudication.model, OUTPUT_TOKEN_CAPS.adjudication);
  if (!preflight.ok) throw new Error(`Adjudication request for ${date} failed token preflight: ${preflight.reason}`);
  const adjudicationText = (await createResponse(adjudicationBody)).text;
  const adjudication = normalizeAdjudication(AdjudicationOutputSchema.parse(parseModelJson(adjudicationText)));

  validateCitations([
    adjudication.dailyJudgementSnippet,
    adjudication.winnerExplanation,
    ...TARGETS.map((target) => adjudication.entityJudgements[target]),
  ], evidence);

  const entities = aggregateEntities(raw.items, sentiments, adjudication.entityJudgements, evidence);
  const result: DailyResult = DailyResultSchema.parse({
    date,
    generatedAt: new Date().toISOString(),
    samplingMethod: raw.samplingMethod,
    winner: adjudication.winner,
    dailyJudgementSnippet: adjudication.dailyJudgementSnippet,
    winnerExplanation: adjudication.winnerExplanation,
    lowConfidence: scores[adjudication.winner].mentionCount < 10,
    closeCall,
    margin,
    models: {
      entity: MODEL_CONFIG.entity.model,
      sentiment: MODEL_CONFIG.sentiment.model,
      adjudication: MODEL_CONFIG.adjudication.model,
    },
    methodVersion: METHOD_VERSION,
    entities,
    evidence,
  });

  await writeDaily(result);
  await writeRun({ ...run, state: "complete" });
  return true;
}
