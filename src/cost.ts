import { MODEL_CONFIG } from "./config.js";
import type { ResponseStageInfo, RunFile } from "./types.js";

type StageName = "entity" | "sentiment" | "adjudication";

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
  batchEstimateUsd: number;
};

export type RunCost = {
  date: string;
  stages: StageCost[];
  standardUsd: number;
  batchEstimateUsd: number;
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
  if (stage === "entity") return MODEL_CONFIG.entity.model;
  if (stage === "sentiment") return MODEL_CONFIG.sentiment.model;
  return MODEL_CONFIG.adjudication.model;
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
    batchEstimateUsd: standardUsd * 0.5,
  };
}

export function calculateRunCost(run: RunFile): RunCost {
  const stages: StageCost[] = [
    stageCost("entity", run.responses.entity),
    stageCost("sentiment", run.responses.sentiment),
    stageCost("adjudication", run.responses.adjudication),
  ];
  return {
    date: run.date,
    stages,
    standardUsd: stages.reduce((sum, stage) => sum + stage.standardUsd, 0),
    batchEstimateUsd: stages.reduce((sum, stage) => sum + stage.batchEstimateUsd, 0),
  };
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}
