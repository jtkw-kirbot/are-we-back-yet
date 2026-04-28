import { promises as fs } from "node:fs";
import path from "node:path";
import { MODEL_CONFIG, METHOD_VERSION } from "./config.js";
import { sentimentTargetsForMentions } from "./entity-routing.js";
import { batchDir, ensureDir, listRuns, readJson, readRawDay, readRun, writeJson, writeRun } from "./io.js";
import { createBatch, downloadFile, getBatch, parseBatchOutput, uploadBatchFile } from "./openai-client.js";
import { entityRequestBody, sentimentRequestBody } from "./prompts.js";
import {
  EntityResultSchema,
  SentimentResultSchema,
  type BatchInfo,
  type EntityResult,
  type HnItem,
  type RunFile,
  type SentimentResult,
} from "./types.js";

type BatchKind = "entity" | "sentiment";

const ACTIVE_BATCH_STATUSES = new Set(["validating", "in_progress", "finalizing", "cancelling"]);
const TOKEN_LIMIT_ERROR = "Enqueued token limit reached";

function nowIso(): string {
  return new Date().toISOString();
}

function jsonlLine(customId: string, body: unknown): string {
  return JSON.stringify({
    custom_id: customId,
    method: "POST",
    url: "/v1/responses",
    body,
  });
}

function parseModelJson<T>(text: string, parser: { parse(value: unknown): T }): T {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return parser.parse(JSON.parse(trimmed));
}

function itemHasText(item: HnItem): boolean {
  return Boolean(item.title || item.text || item.url || item.storyTitle);
}

function batchInputPath(date: string, kind: BatchKind): string {
  return path.join(batchDir(date), `${kind}-input.jsonl`);
}

function batchOutputPath(date: string, kind: BatchKind): string {
  return path.join(batchDir(date), `${kind}-output.jsonl`);
}

function batchErrorPath(date: string, kind: BatchKind): string {
  return path.join(batchDir(date), `${kind}-error.jsonl`);
}

function parsedPath(date: string, kind: BatchKind): string {
  return path.join(batchDir(date), `${kind}-results.json`);
}

function summarizeBatchErrors(details: unknown): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const data = (details as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const first = data[0];
  if (typeof first !== "object" || first === null) return undefined;
  const record = first as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : undefined;
  const line = typeof record.line === "number" ? `line ${record.line}: ` : "";
  return message ? `${line}${message}` : undefined;
}

function batchSubmitLimit(): number {
  const raw = process.env.BATCH_SUBMIT_LIMIT;
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function hasActiveBatch(runs: RunFile[]): boolean {
  return runs.some((run) => Object.values(run.batches).some((batch) => batch && ACTIVE_BATCH_STATUSES.has(batch.status)));
}

export async function createFetchedRun(date: string, samplingMethod: RunFile["samplingMethod"]): Promise<void> {
  const createdAt = nowIso();
  await writeRun({
    date,
    samplingMethod,
    state: "fetched",
    createdAt,
    updatedAt: createdAt,
    batches: {},
  });
}

async function writeJsonl(filePath: string, lines: string[]): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

export async function submitEntityBatch(date: string): Promise<boolean> {
  const run = await readRun(date);
  if (run.state !== "fetched") return false;

  const raw = await readRawDay(date);
  const lines = raw.items
    .filter(itemHasText)
    .map((item) => jsonlLine(`entity:${date}:${item.id}`, entityRequestBody(item)));

  await writeJsonl(batchInputPath(date, "entity"), lines);

  if (lines.length === 0) {
    await writeJson(parsedPath(date, "entity"), []);
    await writeRun({ ...run, state: "entity_complete" });
    return true;
  }

  const inputFileId = await uploadBatchFile(batchInputPath(date, "entity"));
  const batch = await createBatch(inputFileId, {
    date,
    kind: "entity",
    model: MODEL_CONFIG.entity.model,
    prompt: METHOD_VERSION.entityPrompt,
  });

  const batchInfo: BatchInfo = {
    id: batch.id,
    inputFileId,
    status: batch.status,
    submittedAt: nowIso(),
  };

  await writeRun({
    ...run,
    state: "entity_submitted",
    batches: { ...run.batches, entity: batchInfo },
  });
  return true;
}

function mapItemsById(items: HnItem[]): Map<number, HnItem> {
  return new Map(items.map((item) => [item.id, item]));
}

export async function submitSentimentBatch(date: string): Promise<boolean> {
  const run = await readRun(date);
  if (run.state !== "entity_complete") return false;

  const raw = await readRawDay(date);
  const items = mapItemsById(raw.items);
  const entityResults = await readJson(parsedPath(date, "entity"), EntityResultSchema.array());
  const lines: string[] = [];

  for (const result of entityResults) {
    const item = items.get(result.itemId);
    if (!item) continue;
    const activeMentions = result.mentions
      .filter((mention) => mention.mentionType !== "irrelevant" && mention.confidence >= 0.3);
    const targets = sentimentTargetsForMentions(activeMentions, item);
    if (targets.length === 0) continue;
    lines.push(jsonlLine(`sentiment:${date}:${item.id}`, sentimentRequestBody(item, targets, activeMentions)));
  }

  await writeJsonl(batchInputPath(date, "sentiment"), lines);

  if (lines.length === 0) {
    await writeJson(parsedPath(date, "sentiment"), []);
    await writeRun({ ...run, state: "sentiment_complete" });
    return true;
  }

  const inputFileId = await uploadBatchFile(batchInputPath(date, "sentiment"));
  const batch = await createBatch(inputFileId, {
    date,
    kind: "sentiment",
    model: MODEL_CONFIG.sentiment.model,
    prompt: METHOD_VERSION.sentimentPrompt,
  });

  const batchInfo: BatchInfo = {
    id: batch.id,
    inputFileId,
    status: batch.status,
    submittedAt: nowIso(),
  };

  await writeRun({
    ...run,
    state: "sentiment_submitted",
    batches: { ...run.batches, sentiment: batchInfo },
  });
  return true;
}

function parseEntityOutput(content: string): EntityResult[] {
  return parseBatchOutput(content).map((row) => parseModelJson(row.text, EntityResultSchema));
}

function parseSentimentOutput(content: string): SentimentResult[] {
  return parseBatchOutput(content).map((row) => parseModelJson(row.text, SentimentResultSchema));
}

async function completeBatch(run: RunFile, kind: BatchKind): Promise<RunFile> {
  const info = run.batches[kind];
  if (!info) throw new Error(`${run.date} has no ${kind} batch.`);

  const latest = await getBatch(info.id);
  const updatedInfo: BatchInfo = {
    ...info,
    status: latest.status,
  };
  if (latest.output_file_id) updatedInfo.outputFileId = latest.output_file_id;
  if (latest.error_file_id) updatedInfo.errorFileId = latest.error_file_id;
  if (latest.errors) updatedInfo.errorDetails = latest.errors;
  if (latest.completed_at) updatedInfo.completedAt = new Date(latest.completed_at * 1000).toISOString();

  if (latest.status === "completed") {
    if (!latest.output_file_id) throw new Error(`${kind} batch completed without output file.`);
    const output = await downloadFile(latest.output_file_id);
    await ensureDir(batchDir(run.date));
    await fs.writeFile(batchOutputPath(run.date, kind), output, "utf8");
    const parsed = kind === "entity" ? parseEntityOutput(output) : parseSentimentOutput(output);
    await writeJson(parsedPath(run.date, kind), parsed);
    return {
      ...run,
      state: kind === "entity" ? "entity_complete" : "sentiment_complete",
      batches: { ...run.batches, [kind]: updatedInfo },
    };
  }

  if (["failed", "expired", "cancelled", "cancelling"].includes(latest.status)) {
    if (latest.error_file_id) {
      await ensureDir(batchDir(run.date));
      await fs.writeFile(batchErrorPath(run.date, kind), await downloadFile(latest.error_file_id), "utf8");
    }
    const summary = summarizeBatchErrors(latest.errors);
    return {
      ...run,
      state: "failed",
      error: `${kind} batch ${latest.id} ended with status ${latest.status}${summary ? `: ${summary}` : ""}`,
      batches: { ...run.batches, [kind]: updatedInfo },
    };
  }

  return {
    ...run,
    batches: { ...run.batches, [kind]: updatedInfo },
  };
}

export async function pollPendingBatches(): Promise<number> {
  const runs = await listRuns();
  let changed = 0;

  for (const run of runs) {
    if (run.state === "entity_submitted") {
      const updated = await completeBatch(run, "entity");
      await writeRun(updated);
      if (updated.state !== run.state || updated.batches.entity?.status !== run.batches.entity?.status) changed += 1;
    }
    if (run.state === "sentiment_submitted") {
      const updated = await completeBatch(run, "sentiment");
      await writeRun(updated);
      if (updated.state !== run.state || updated.batches.sentiment?.status !== run.batches.sentiment?.status) changed += 1;
    }
    if (run.state === "failed") {
      if (run.batches.sentiment?.status === "failed" && !run.batches.sentiment.errorDetails) {
        const updated = await completeBatch(run, "sentiment");
        await writeRun(updated);
        if (updated.error !== run.error || updated.batches.sentiment?.errorDetails) changed += 1;
      } else if (run.batches.entity?.status === "failed" && !run.batches.entity.errorDetails) {
        const updated = await completeBatch(run, "entity");
        await writeRun(updated);
        if (updated.error !== run.error || updated.batches.entity?.errorDetails) changed += 1;
      }
    }
  }

  return changed;
}

export async function submitAllEntityBatches(date?: string): Promise<number> {
  const runs = await listRuns();
  if (hasActiveBatch(runs)) return 0;
  if (date) return (await submitEntityBatch(date)) ? 1 : 0;
  let count = 0;
  const limit = batchSubmitLimit();
  for (const run of runs) {
    if (run.state === "fetched" && await submitEntityBatch(run.date)) count += 1;
    if (count >= limit) break;
  }
  return count;
}

export async function submitAllSentimentBatches(date?: string): Promise<number> {
  const runs = await listRuns();
  if (hasActiveBatch(runs)) return 0;
  if (date) return (await submitSentimentBatch(date)) ? 1 : 0;
  let count = 0;
  const limit = batchSubmitLimit();
  for (const run of runs) {
    if (run.state === "entity_complete" && await submitSentimentBatch(run.date)) count += 1;
    if (count >= limit) break;
  }
  return count;
}

export async function retryTokenLimitFailures(): Promise<number> {
  const runs = await listRuns();
  let count = 0;
  for (const run of runs) {
    if (run.state !== "failed" || !run.error?.includes(TOKEN_LIMIT_ERROR)) continue;
    await writeRun({
      date: run.date,
      samplingMethod: run.samplingMethod,
      state: "fetched",
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      batches: {},
    });
    count += 1;
  }
  return count;
}

export async function reprocessDay(date: string): Promise<boolean> {
  const raw = await readRawDay(date);
  await createFetchedRun(date, raw.samplingMethod);
  return submitEntityBatch(date);
}

export function batchParsedPath(date: string, kind: BatchKind): string {
  return parsedPath(date, kind);
}
