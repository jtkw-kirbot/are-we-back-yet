import { AGGREGATION_CONFIG, METHOD_VERSION, MODEL_CONFIG, SAMPLING_METHOD, TARGETS } from "./config.js";
import type {
  Bucket,
  DailyResult,
  Direction,
  Evidence,
  EvidenceAnnotation,
  LabelConfidence,
  Support,
  Target,
  TargetDailyResult,
} from "./types.js";

type TargetAccumulator = {
  target: Target;
  evidenceIds: Set<string>;
  positive: number;
  neutral: number;
  negative: number;
  confidenceScore: number;
  attributionConfidenceScore: number;
  annotationCount: number;
  byStory: Map<number, {
    effectiveSupport: number;
    weightedStance: number;
  }>;
};

const CONFIDENCE_SCORE: Record<LabelConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function directionFor(value: number): Direction {
  if (value <= AGGREGATION_CONFIG.buckets.negativeMax) return "negative";
  if (value >= AGGREGATION_CONFIG.buckets.positiveMin) return "positive";
  return "neutral";
}

export function bucketForAdjustedMean(value: number): Bucket {
  if (value <= AGGREGATION_CONFIG.buckets.stronglyNegativeMax) return "strongly_negative";
  if (value <= AGGREGATION_CONFIG.buckets.negativeMax) return "negative";
  if (value >= AGGREGATION_CONFIG.buckets.stronglyPositiveMin) return "strongly_positive";
  if (value >= AGGREGATION_CONFIG.buckets.positiveMin) return "positive";
  return "mixed_neutral";
}

function supportFor(effectiveSupport: number, evidenceCount: number): Support {
  if (effectiveSupport < 2 || evidenceCount < 2) return "low";
  if (effectiveSupport < 5) return "medium";
  return "high";
}

function confidenceFor(
  support: Support,
  annotationCount: number,
  confidenceScore: number,
  attributionConfidenceScore: number,
): LabelConfidence {
  if (annotationCount === 0) return "low";
  const average = (confidenceScore + attributionConfidenceScore) / (annotationCount * 2);
  if (support === "high" && average >= 2.5) return "high";
  if (support === "low" || average < 1.75) return "low";
  return "medium";
}

function sourceWeight(evidence: Evidence): number {
  return evidence.sourceType === "title" ? AGGREGATION_CONFIG.titleWeight : AGGREGATION_CONFIG.commentWeight;
}

function annotationWeight(evidence: Evidence, annotation: EvidenceAnnotation): number {
  return sourceWeight(evidence) * AGGREGATION_CONFIG.relevanceMultipliers[annotation.relevance];
}

function newAccumulator(target: Target): TargetAccumulator {
  return {
    target,
    evidenceIds: new Set<string>(),
    positive: 0,
    neutral: 0,
    negative: 0,
    confidenceScore: 0,
    attributionConfidenceScore: 0,
    annotationCount: 0,
    byStory: new Map(),
  };
}

function noteFor(result: Pick<TargetDailyResult, "support" | "direction" | "evidenceBalance">): TargetDailyResult["rankNote"] {
  if (result.support === "low") return "low_support";
  if (
    result.direction === "neutral" &&
    result.support === "high" &&
    result.evidenceBalance.positive > 0 &&
    result.evidenceBalance.negative > 0
  ) {
    return "mixed_high_volume";
  }
  return undefined;
}

function addAnnotation(accumulator: TargetAccumulator, evidence: Evidence, annotation: EvidenceAnnotation): void {
  const weight = annotationWeight(evidence, annotation);
  const story = accumulator.byStory.get(evidence.storyId) ?? {
    effectiveSupport: 0,
    weightedStance: 0,
  };
  story.effectiveSupport += weight;
  story.weightedStance += weight * annotation.stance;
  accumulator.byStory.set(evidence.storyId, story);
  accumulator.evidenceIds.add(evidence.id);
  accumulator.annotationCount += 1;
  accumulator.confidenceScore += CONFIDENCE_SCORE[annotation.confidence];
  accumulator.attributionConfidenceScore += CONFIDENCE_SCORE[annotation.attributionConfidence];
  if (annotation.stance > 0) accumulator.positive += 1;
  else if (annotation.stance < 0) accumulator.negative += 1;
  else accumulator.neutral += 1;
}

function finalizeTarget(accumulator: TargetAccumulator): TargetDailyResult | undefined {
  if (accumulator.annotationCount === 0) return undefined;

  let effectiveSupport = 0;
  let weightedStance = 0;
  for (const story of accumulator.byStory.values()) {
    const scale = story.effectiveSupport > AGGREGATION_CONFIG.perStoryTargetCap
      ? AGGREGATION_CONFIG.perStoryTargetCap / story.effectiveSupport
      : 1;
    effectiveSupport += story.effectiveSupport * scale;
    weightedStance += story.weightedStance * scale;
  }

  const rawMean = effectiveSupport === 0 ? 0 : weightedStance / effectiveSupport;
  const adjustedMean = rawMean * effectiveSupport / (effectiveSupport + AGGREGATION_CONFIG.shrinkageConstant);
  const evidenceIds = [...accumulator.evidenceIds];
  const support = supportFor(effectiveSupport, evidenceIds.length);
  const bucket = bucketForAdjustedMean(adjustedMean);
  const direction = directionFor(adjustedMean);
  const confidence = confidenceFor(
    support,
    accumulator.annotationCount,
    accumulator.confidenceScore,
    accumulator.attributionConfidenceScore,
  );
  const evidenceBalance = {
    positive: accumulator.positive,
    neutral: accumulator.neutral,
    negative: accumulator.negative,
  };
  const base: TargetDailyResult = {
    target: accumulator.target,
    bucket,
    direction,
    support,
    confidence,
    rawMean: roundMetric(rawMean),
    adjustedMean: roundMetric(adjustedMean),
    effectiveSupport: roundMetric(effectiveSupport),
    evidenceBalance,
    displayRank: 1,
    tiedWith: [],
    evidenceIds,
    summary: "",
  };
  const rankNote = noteFor(base);
  return rankNote ? { ...base, rankNote } : base;
}

function applyRanksAndTies(ranking: TargetDailyResult[]): TargetDailyResult[] {
  const out = ranking.map((item) => ({ ...item, tiedWith: [...item.tiedWith] }));
  let index = 0;
  while (index < out.length) {
    const group = [index];
    let next = index + 1;
    while (
      next < out.length &&
      out[next]?.bucket === out[index]?.bucket &&
      Math.abs((out[next]?.adjustedMean ?? 0) - (out[index]?.adjustedMean ?? 0)) <= AGGREGATION_CONFIG.tieThreshold
    ) {
      group.push(next);
      next += 1;
    }
    const displayRank = index + 1;
    const tiedTargets = group.map((itemIndex) => out[itemIndex]?.target).filter((target): target is Target => Boolean(target));
    for (const itemIndex of group) {
      const item = out[itemIndex];
      if (!item) continue;
      item.displayRank = displayRank;
      item.tiedWith = tiedTargets.filter((target) => target !== item.target);
      if (item.tiedWith.length > 0) item.rankNote = "close_tie";
    }
    index = next;
  }
  return out;
}

function primarySignal(ranking: TargetDailyResult[]): Pick<
  DailyResult,
  "primarySignalTarget" | "primarySignalTargets" | "primarySignalTie" | "primarySignalDirection" | "hasLowSupportLeader"
> {
  const directional = ranking.filter((item) => Math.abs(item.adjustedMean) >= AGGREGATION_CONFIG.primarySignalNeutralThreshold);
  if (directional.length === 0) {
    return {
      primarySignalTarget: null,
      primarySignalTargets: [],
      primarySignalTie: false,
      primarySignalDirection: "neutral",
      hasLowSupportLeader: false,
    };
  }
  const maxAbs = Math.max(...directional.map((item) => Math.abs(item.adjustedMean)));
  const targets = directional
    .filter((item) => Math.abs(Math.abs(item.adjustedMean) - maxAbs) <= AGGREGATION_CONFIG.tieThreshold)
    .sort((a, b) => a.displayRank - b.displayRank || a.target.localeCompare(b.target));
  const positiveCount = targets.filter((item) => item.direction === "positive").length;
  const negativeCount = targets.filter((item) => item.direction === "negative").length;
  const primarySignalDirection: Direction = positiveCount > 0 && negativeCount > 0
    ? "neutral"
    : positiveCount > 0
      ? "positive"
      : "negative";
  const primarySignalTargets = targets.map((item) => item.target);
  const primarySignalTie = primarySignalTargets.length > 1;
  return {
    primarySignalTarget: primarySignalTie ? null : primarySignalTargets[0] ?? null,
    primarySignalTargets,
    primarySignalTie,
    primarySignalDirection,
    hasLowSupportLeader: targets.some((item) => item.support === "low"),
  };
}

export function aggregateDailyEvidence(input: {
  date: string;
  generatedAt: string;
  evidence: Evidence[];
  models?: Record<string, string>;
}): DailyResult {
  const accumulators = new Map<Target, TargetAccumulator>(
    TARGETS.map((target) => [target, newAccumulator(target)]),
  );

  for (const evidence of input.evidence) {
    for (const annotation of evidence.annotations) {
      const accumulator = accumulators.get(annotation.target);
      if (!accumulator) continue;
      addAnnotation(accumulator, evidence, annotation);
    }
  }

  const ranking = applyRanksAndTies(
    [...accumulators.values()]
      .flatMap((accumulator) => {
        const result = finalizeTarget(accumulator);
        return result ? [result] : [];
      })
      .sort((a, b) => a.adjustedMean - b.adjustedMean || a.target.localeCompare(b.target)),
  );
  const rankedTargets = new Set(ranking.map((item) => item.target));
  const unmentioned = TARGETS.filter((target) => !rankedTargets.has(target));

  return {
    date: input.date,
    generatedAt: input.generatedAt,
    samplingMethod: SAMPLING_METHOD,
    rankingDirection: "most_negative_to_most_positive",
    headlineSummary: "",
    ...primarySignal(ranking),
    ranking,
    unmentioned,
    evidence: input.evidence,
    models: input.models ?? {
      evidenceDetection: MODEL_CONFIG.evidenceDetection.model,
      dailySummary: MODEL_CONFIG.dailySummary.model,
    },
    methodVersion: METHOD_VERSION,
  };
}

export function withDailySummaries(
  result: DailyResult,
  summaries: {
    headlineSummary: string;
    targetSummaries: Array<{ target: Target; summary: string }>;
  },
): DailyResult {
  const summaryByTarget = new Map(summaries.targetSummaries.map((item) => [item.target, item.summary]));
  return {
    ...result,
    headlineSummary: summaries.headlineSummary,
    ranking: result.ranking.map((item) => ({
      ...item,
      summary: summaryByTarget.get(item.target) ?? item.summary,
    })),
  };
}
