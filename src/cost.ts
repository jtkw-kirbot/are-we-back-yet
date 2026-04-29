import { MODEL_CONFIG } from "./config.js";
import type { ResponseStageInfo, RunFile } from "./types.js";

type StageName = "evidenceDetection" | "dailySummary";

type ModelPrice = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

type StageCost = {
  stage: StageName;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  standardUsd: number;
};

export type RunCost = {
  date: string;
  stages: StageCost[];
  standardUsd: number;
};

const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-5.4-mini-2026-03-17": {
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 4.50,
  },
  "gpt-5.4-2026-03-05": {
    inputPerMillion: 2.50,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15.00,
  },
};

function stageModel(stage: StageName): string {
  if (stage === "evidenceDetection") return MODEL_CONFIG.evidenceDetection.model;
  if (stage === "dailySummary") return MODEL_CONFIG.dailySummary.model;
  throw new Error(`Unknown stage: ${stage}`);
}

function stageCost(stage: StageName, info: ResponseStageInfo | undefined): StageCost {
  const model = stageModel(stage);
  const price = MODEL_PRICES[model];
  if (!price) throw new Error(`No pricing configured for model ${model}`);

  const inputTokens = info?.inputTokens ?? 0;
  const cachedInputTokens = info?.cachedInputTokens ?? 0;
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = info?.outputTokens ?? 0;
  const standardUsd =
    (billableInputTokens / 1_000_000) * price.inputPerMillion +
    (cachedInputTokens / 1_000_000) * price.cachedInputPerMillion +
    (outputTokens / 1_000_000) * price.outputPerMillion;

  return {
    stage,
    model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: info?.totalTokens ?? 0,
    standardUsd,
  };
}

export function calculateRunCost(run: RunFile): RunCost {
  const stages: StageCost[] = [
    stageCost("evidenceDetection", run.responses.evidenceDetection),
    stageCost("dailySummary", run.responses.dailySummary),
  ];
  return {
    date: run.date,
    stages,
    standardUsd: stages.reduce((sum, stage) => sum + stage.standardUsd, 0),
  };
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}
