import { getEncoding } from "js-tiktoken";

export type ModelLimit = {
  contextWindow: number;
  maxOutputTokens: number;
};

export const MODEL_LIMITS: Record<string, ModelLimit> = {
  "gpt-5.4-mini-2026-03-17": {
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
  },
  "gpt-5.4-2026-03-05": {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
  },
};

export const OUTPUT_TOKEN_CAPS = {
  titleAnalysis: 8_192,
  titleAnalysisRetry: 12_288,
} as const;

const SAFETY_BUFFER = 1.2;

let encoder: ReturnType<typeof getEncoding> | undefined;

function getEncoder(): ReturnType<typeof getEncoding> | undefined {
  if (encoder) return encoder;
  try {
    encoder = getEncoding("o200k_base");
    return encoder;
  } catch {
    return undefined;
  }
}

export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const activeEncoder = getEncoder();
  if (activeEncoder) return activeEncoder.encode(text).length;
  return Math.ceil(text.length / 3);
}

export function modelLimit(model: string): ModelLimit {
  const limit = MODEL_LIMITS[model];
  if (!limit) throw new Error(`No token limit configured for model ${model}`);
  return limit;
}

export type TokenPreflight = {
  ok: boolean;
  model: string;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  reason?: string;
};

export function preflightResponseBody(body: unknown, model: string, reservedOutputTokens: number): TokenPreflight {
  const limit = modelLimit(model);
  const estimatedInputTokens = estimateTokens(body);
  const estimatedTotal = Math.ceil(estimatedInputTokens * SAFETY_BUFFER) + reservedOutputTokens;
  if (reservedOutputTokens > limit.maxOutputTokens) {
    return {
      ok: false,
      model,
      estimatedInputTokens,
      reservedOutputTokens,
      contextWindow: limit.contextWindow,
      maxOutputTokens: limit.maxOutputTokens,
      reason: "reserved_output_exceeds_model_limit",
    };
  }
  if (estimatedTotal > limit.contextWindow) {
    return {
      ok: false,
      model,
      estimatedInputTokens,
      reservedOutputTokens,
      contextWindow: limit.contextWindow,
      maxOutputTokens: limit.maxOutputTokens,
      reason: "oversize_input_preflight",
    };
  }
  return {
    ok: true,
    model,
    estimatedInputTokens,
    reservedOutputTokens,
    contextWindow: limit.contextWindow,
    maxOutputTokens: limit.maxOutputTokens,
  };
}

export function withResponseSafeguards<T extends Record<string, unknown>>(body: T, maxOutputTokens: number): T & {
  max_output_tokens: number;
  truncation: "disabled";
} {
  return {
    ...body,
    max_output_tokens: maxOutputTokens,
    truncation: "disabled",
  };
}
