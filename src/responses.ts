import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MODEL_CONFIG, METHOD_VERSION } from "./config.js";
import { writeDailyReport } from "./aggregate.js";
import { sentimentTargetsForMentions } from "./entity-routing.js";
import { ensureDir, pathExists, readJson, readRawDay, readRun, responseDir, writeJson, writeRun } from "./io.js";
import { createResponse, OpenAiStatusError, type OpenAiUsage } from "./openai-client.js";
import { entityRequestBody, sentimentRequestBody } from "./prompts.js";
import { OUTPUT_TOKEN_CAPS, preflightResponseBody, withResponseSafeguards } from "./token-budget.js";
import {
  EntityResultSchema,
  SentimentResultSchema,
  type EntityResult,
  type HnItem,
  type ResponseStageInfo,
  type RunFile,
  type SamplingMethod,
  type SentimentResult,
} from "./types.js";
import { z } from "zod";

type Stage = "entity" | "sentiment";

type RowStatus = "success" | "quarantined";

type StageRow<T> = {
  date: string;
  stage: Stage;
  itemId: number;
  requestHash: string;
  attempt: number;
  status: RowStatus;
  responseId?: string | undefined;
  usage?: OpenAiUsage | undefined;
  result?: T | undefined;
  error?: string | undefined;
  errorType?: string | undefined;
};

type StageRequest<T> = {
  itemId: number;
  body: Record<string, unknown>;
  hashBody: unknown;
  schema: z.ZodType<T>;
};

type StageProgress<T> = {
  complete: boolean;
  attempted: number;
  successRows: Array<StageRow<T>>;
  quarantineRows: Array<StageRow<T>>;
};

type RowBudget = {
  remaining: number;
};

const DEFAULT_MAX_ROWS_PER_RUN = 1_000;
const DEFAULT_CONCURRENCY = 8;

function nowIso(): string {
  return new Date().toISOString();
}

function itemHasText(item: HnItem): boolean {
  return Boolean(item.title || item.text);
}

function responseStagePath(date: string, stage: Stage, suffix: string): string {
  return path.join(responseDir(date), `${stage}-${suffix}`);
}

function stageRowsPath(date: string, stage: Stage): string {
  return responseStagePath(date, stage, "rows.jsonl");
}

function stageResultsPath(date: string, stage: Stage): string {
  return responseStagePath(date, stage, "results.json");
}

function quarantinePath(date: string): string {
  return path.join(responseDir(date), "quarantine.jsonl");
}

function requestHash(stage: Stage, hashBody: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({
      stage,
      methodVersion: stage === "entity" ? METHOD_VERSION.entityPrompt : METHOD_VERSION.sentimentPrompt,
      hashBody,
    }))
    .digest("hex");
}

function maxRowsPerRun(): number {
  const value = Number(process.env.RESPONSES_MAX_ROWS_PER_RUN ?? DEFAULT_MAX_ROWS_PER_RUN);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_ROWS_PER_RUN;
}

function concurrency(): number {
  const value = Number(process.env.RESPONSES_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_CONCURRENCY;
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  if (!(await pathExists(filePath))) return [];
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function appendJsonl(filePath: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function usageTotals(rows: Array<StageRow<unknown>>): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  return rows.reduce((totals, row) => ({
    inputTokens: totals.inputTokens + (row.usage?.input_tokens ?? 0),
    cachedInputTokens: totals.cachedInputTokens + (row.usage?.input_tokens_details?.cached_tokens ?? 0),
    outputTokens: totals.outputTokens + (row.usage?.output_tokens ?? 0),
    totalTokens: totals.totalTokens + (row.usage?.total_tokens ?? 0),
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

function freshStageInfo(startedAt = nowIso()): ResponseStageInfo {
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

function quarantineLimit(attempted: number): number {
  return Math.max(5, Math.ceil(attempted * 0.01));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOpenAiError(error: unknown): error is OpenAiStatusError {
  return error instanceof OpenAiStatusError && (error.status === 429 || error.status >= 500);
}

function errorKey(error: unknown): string {
  if (error instanceof OpenAiStatusError) return `openai_${error.status}`;
  return error instanceof Error ? error.message : String(error);
}

async function callRow<T>(date: string, stage: Stage, request: StageRequest<T>): Promise<StageRow<T>> {
  const hash = requestHash(stage, request.hashBody);
  const model = stage === "entity" ? MODEL_CONFIG.entity.model : MODEL_CONFIG.sentiment.model;
  const caps = [OUTPUT_TOKEN_CAPS.rowInitial, OUTPUT_TOKEN_CAPS.rowRetry];
  let attempt = 0;
  let validationRetried = false;
  let rateAttempt = 0;

  while (true) {
    const cap = caps[Math.min(attempt, caps.length - 1)] ?? OUTPUT_TOKEN_CAPS.rowRetry;
    const body = withResponseSafeguards(request.body, cap);
    const preflight = preflightResponseBody(body, model, cap);
    if (!preflight.ok) {
      return {
        date,
        stage,
        itemId: request.itemId,
        requestHash: hash,
        attempt: attempt + 1,
        status: "quarantined",
        error: preflight.reason ?? "token_preflight_failed",
        errorType: "oversize_input_preflight",
      };
    }

    try {
      const response = await createResponse(body);
      if (response.status === "incomplete" && response.incompleteReason === "max_output_tokens" && attempt === 0) {
        attempt += 1;
        continue;
      }
      if (response.status === "incomplete") {
        return {
          date,
          stage,
          itemId: request.itemId,
          requestHash: hash,
          attempt: attempt + 1,
          status: "quarantined",
          responseId: response.id,
          usage: response.usage,
          error: response.incompleteReason ?? "response_incomplete",
          errorType: "response_incomplete",
        };
      }

      const result = request.schema.parse(parseModelJson(response.text));
      return {
        date,
        stage,
        itemId: request.itemId,
        requestHash: hash,
        attempt: attempt + 1,
        status: "success",
        responseId: response.id,
        usage: response.usage,
        result,
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
      return {
        date,
        stage,
        itemId: request.itemId,
        requestHash: hash,
        attempt: attempt + 1,
        status: "quarantined",
        error: error instanceof Error ? error.message : String(error),
        errorType: errorKey(error),
      };
    }
  }
}

function latestRowsByHash<T>(rows: Array<StageRow<T>>): Map<string, StageRow<T>> {
  const latest = new Map<string, StageRow<T>>();
  for (const row of rows) latest.set(`${row.itemId}:${row.requestHash}:${row.status}`, row);
  return latest;
}

async function processStage<T>(
  date: string,
  stage: Stage,
  requests: Array<StageRequest<T>>,
  budget: RowBudget,
): Promise<StageProgress<T>> {
  await ensureDir(responseDir(date));
  const rowPath = stageRowsPath(date, stage);
  const quarantineFile = quarantinePath(date);
  const existingRows = await readJsonl<StageRow<T>>(rowPath);
  const existingQuarantines = await readJsonl<StageRow<T>>(quarantineFile);
  const successByHash = latestRowsByHash(existingRows.filter((row) => row.status === "success"));
  const quarantineByHash = latestRowsByHash(existingQuarantines.filter((row) => row.stage === stage));
  const successRows: Array<StageRow<T>> = [];
  const quarantineRows: Array<StageRow<T>> = [];
  const pending: Array<StageRequest<T>> = [];

  for (const request of requests) {
    const hash = requestHash(stage, request.hashBody);
    const success = successByHash.get(`${request.itemId}:${hash}:success`);
    const quarantine = quarantineByHash.get(`${request.itemId}:${hash}:quarantined`);
    if (success) successRows.push(success);
    else if (quarantine) quarantineRows.push(quarantine);
    else pending.push(request);
  }

  const toAttempt = pending.slice(0, budget.remaining);
  budget.remaining -= toAttempt.length;
  const newRows: Array<StageRow<T>> = [];
  let consecutiveError: string | undefined;
  let consecutiveErrorCount = 0;

  for (let index = 0; index < toAttempt.length; index += concurrency()) {
    const chunk = toAttempt.slice(index, index + concurrency());
    const chunkRows = await Promise.all(chunk.map((request) => callRow(date, stage, request)));
    newRows.push(...chunkRows);

    for (const row of chunkRows) {
      if (row.status === "success") {
        consecutiveError = undefined;
        consecutiveErrorCount = 0;
        continue;
      }
      const currentError = row.errorType ?? row.error ?? "unknown_error";
      if (currentError === consecutiveError && !currentError.includes("429")) consecutiveErrorCount += 1;
      else {
        consecutiveError = currentError;
        consecutiveErrorCount = 1;
      }
      if (consecutiveErrorCount >= 3) {
        throw new Error(`${stage} stage aborted after repeated ${currentError} errors`);
      }
    }
  }

  await appendJsonl(rowPath, newRows);
  await appendJsonl(quarantineFile, newRows.filter((row) => row.status === "quarantined"));

  const allSuccessRows = [...successRows, ...newRows.filter((row) => row.status === "success")];
  const allQuarantineRows = [...quarantineRows, ...newRows.filter((row) => row.status === "quarantined")];
  const doneCount = allSuccessRows.length + allQuarantineRows.length;
  return {
    complete: doneCount === requests.length,
    attempted: doneCount,
    successRows: allSuccessRows,
    quarantineRows: allQuarantineRows,
  };
}

function entityRequests(items: HnItem[]): Array<StageRequest<EntityResult>> {
  return items.filter(itemHasText).map((item) => {
    const body = entityRequestBody(item) as Record<string, unknown>;
    return {
      itemId: item.id,
      body,
      hashBody: body,
      schema: EntityResultSchema,
    };
  });
}

function sentimentRequests(items: HnItem[], entityResults: EntityResult[]): Array<StageRequest<SentimentResult>> {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const requests: Array<StageRequest<SentimentResult>> = [];
  for (const result of entityResults) {
    const item = itemsById.get(result.itemId);
    if (!item) continue;
    const activeMentions = result.mentions
      .filter((mention) => mention.mentionType !== "irrelevant" && mention.confidence >= 0.3);
    const targets = sentimentTargetsForMentions(activeMentions, item);
    if (targets.length === 0) continue;
    const body = sentimentRequestBody(item, targets, activeMentions) as Record<string, unknown>;
    requests.push({
      itemId: item.id,
      body,
      hashBody: body,
      schema: SentimentResultSchema,
    });
  }
  return requests;
}

async function updateStageRun(
  run: RunFile,
  stage: Stage,
  state: RunFile["state"],
  progress: StageProgress<unknown>,
): Promise<void> {
  const { error: _error, ...cleanRun } = run;
  const totals = usageTotals(progress.successRows);
  const existing = run.responses[stage] ?? freshStageInfo();
  const stageInfo = {
    ...existing,
    startedAt: existing.startedAt ?? nowIso(),
    processedCount: progress.attempted,
    successCount: progress.successRows.length,
    quarantineCount: progress.quarantineRows.length,
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
  };
  if (state === `${stage}_complete`) stageInfo.completedAt = nowIso();
  await writeRun({
    ...cleanRun,
    state,
    responses: {
      ...run.responses,
      [stage]: stageInfo,
    },
  });
}

async function failRun(run: RunFile, error: unknown): Promise<void> {
  await writeRun({
    ...run,
    state: "failed",
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

export async function processDay(date: string, options: { force?: boolean; budget?: RowBudget } = {}): Promise<boolean> {
  const budget = options.budget ?? { remaining: maxRowsPerRun() };
  let run = await readRun(date);
  if (run.state === "complete" && !options.force) return false;
  if (run.state === "failed" && !options.force) return false;
  if (options.force && run.state === "complete") {
    const { error: _error, ...cleanRun } = run;
    await writeRun({ ...cleanRun, state: "fetched", responses: {} });
    run = await readRun(date);
  }

  try {
    const raw = await readRawDay(date);

    if (run.state === "fetched" || run.state === "entity_processing") {
      await writeRun({
        ...run,
        state: "entity_processing",
        responses: {
          ...run.responses,
          entity: { ...(run.responses.entity ?? freshStageInfo()), startedAt: run.responses.entity?.startedAt ?? nowIso() },
        },
      });
      run = await readRun(date);
      const requests = entityRequests(raw.items);
      const progress = await processStage(date, "entity", requests, budget);
      if (!progress.complete) {
        await updateStageRun(run, "entity", "entity_processing", progress);
        return true;
      }
      if (progress.quarantineRows.length > quarantineLimit(progress.attempted)) {
        throw new Error(`entity stage quarantined ${progress.quarantineRows.length} of ${progress.attempted} rows`);
      }
      await writeJson(stageResultsPath(date, "entity"), progress.successRows.map((row) => row.result));
      await updateStageRun(run, "entity", "entity_complete", progress);
      run = await readRun(date);
    }

    if (run.state === "entity_complete" || run.state === "sentiment_processing") {
      await writeRun({
        ...run,
        state: "sentiment_processing",
        responses: {
          ...run.responses,
          sentiment: { ...(run.responses.sentiment ?? freshStageInfo()), startedAt: run.responses.sentiment?.startedAt ?? nowIso() },
        },
      });
      run = await readRun(date);
      const entityResults = await readJson(stageResultsPath(date, "entity"), EntityResultSchema.array());
      const requests = sentimentRequests(raw.items, entityResults);
      const progress = await processStage(date, "sentiment", requests, budget);
      if (!progress.complete) {
        await updateStageRun(run, "sentiment", "sentiment_processing", progress);
        return true;
      }
      if (progress.quarantineRows.length > quarantineLimit(progress.attempted)) {
        throw new Error(`sentiment stage quarantined ${progress.quarantineRows.length} of ${progress.attempted} rows`);
      }
      await writeJson(stageResultsPath(date, "sentiment"), progress.successRows.map((row) => row.result));
      await updateStageRun(run, "sentiment", "sentiment_complete", progress);
      run = await readRun(date);
    }

    if (run.state === "sentiment_complete") {
      await writeDailyReport(date);
      return true;
    }

    return false;
  } catch (error) {
    await failRun(run, error);
    console.error(error instanceof Error ? error.message : error);
    return true;
  }
}
