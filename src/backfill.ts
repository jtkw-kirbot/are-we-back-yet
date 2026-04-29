import { promises as fs } from "node:fs";
import { analyzeDay, createFetchedRun, markSkippedRun } from "./analyze.js";
import { NEW_METHOD_START_DATE, SAMPLING_METHOD } from "./config.js";
import { calculateRunCost, formatUsd, type RunCost } from "./cost.js";
import { fetchFrontPageForDate } from "./hn.js";
import {
  dailyPath,
  pathExists,
  rawPath,
  readJson,
  readRawDay,
  readRun,
  runPath,
  writeRawDay,
  writeRun,
} from "./io.js";
import { buildSite } from "./site.js";
import { localDate } from "./time.js";
import { DailyResultSchema, type RunFile } from "./types.js";

const DEFAULT_SYNC_CONCURRENCY = 3;
const GITHUB_COMMAND_ATTEMPT_TIMEOUT_MS = 45_000;
const GITHUB_COMMAND_TOTAL_TIMEOUT_MS = 180_000;

type SyncOptions = {
  start: string;
  end: string;
  force?: boolean;
  noPublish?: boolean;
  concurrency?: number;
  continueOnError?: boolean;
  allowEmptyEndDate?: boolean;
};

type DailySyncOptions = {
  force?: boolean;
  concurrency?: number;
};

type SyncResult = {
  date: string;
  run: RunFile;
  cost: RunCost;
};

function nowIso(): string {
  return new Date().toISOString();
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function expandDateRange(start: string, end: string): string[] {
  assertDate(start, "--start");
  assertDate(end, "--end");
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  if (cursor > endDate) throw new Error("--start must be on or before --end");

  const dates: string[] = [];
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function isRetryableGithubErrorText(text: string): boolean {
  return [
    /failed to connect to github\.com.*443/i,
    /could not connect to server/i,
    /could not resolve host/i,
    /connection timed out/i,
    /operation timed out/i,
    /process timed out/i,
    /\bi\/o timeout\b/i,
    /tls.*timeout/i,
    /connection reset/i,
    /connection refused/i,
    /remote end hung up unexpectedly/i,
    /early eof/i,
    /rpc failed/i,
    /\bhttp\s+5\d\d\b/i,
    /bad gateway/i,
    /service unavailable/i,
    /gateway timeout/i,
  ].some((pattern) => pattern.test(text));
}

export function githubRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 2 ** attempt * 3_000);
}

export function githubCommandAttemptTimeoutMs(): number {
  return GITHUB_COMMAND_ATTEMPT_TIMEOUT_MS;
}

export function githubCommandTotalTimeoutMs(): number {
  return GITHUB_COMMAND_TOTAL_TIMEOUT_MS;
}

function rangeLabel(dates: string[]): string {
  const first = dates[0] ?? "";
  const last = dates[dates.length - 1] ?? first;
  if (dates.length === 1) return first;
  return `${first} through ${last}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: Array<R | undefined> = new Array<R | undefined>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results.map((result, index) => {
    if (result === undefined) throw new Error(`Missing sync result at index ${index}`);
    return result;
  });
}

async function resetGeneratedDate(date: string): Promise<void> {
  await fs.rm(rawPath(date), { force: true });
  await fs.rm(runPath(date), { force: true });
  await fs.rm(dailyPath(date), { force: true });
}

async function hasCompleteNewDailyResult(date: string): Promise<boolean> {
  if (!(await pathExists(dailyPath(date)))) return false;
  try {
    const result = await readJson(dailyPath(date), DailyResultSchema);
    return result.samplingMethod === SAMPLING_METHOD && result.methodVersion.schema === "daily-v4";
  } catch {
    return false;
  }
}

async function latestContiguousCompletedDate(endDate: string): Promise<string | undefined> {
  let cursor = NEW_METHOD_START_DATE;
  let latest: string | undefined;
  while (cursor <= endDate) {
    if (!(await hasCompleteNewDailyResult(cursor))) break;
    latest = cursor;
    cursor = nextDate(cursor);
  }
  return latest;
}

async function ensureFrontPageRaw(date: string, force: boolean, allowEmpty: boolean): Promise<"ready" | "skipped"> {
  if (force) await resetGeneratedDate(date);
  if (await pathExists(rawPath(date))) {
    try {
      const raw = await readRawDay(date);
      if (raw.samplingMethod === SAMPLING_METHOD && raw.items.every((item) => Array.isArray(item.topComments))) {
        if (!(await pathExists(runPath(date)))) await createFetchedRun(date, SAMPLING_METHOD);
        console.log(`${date}: using existing front?day story/comment snapshot`);
        return "ready";
      }
    } catch {
      console.log(`${date}: replacing incompatible raw snapshot`);
    }
    await resetGeneratedDate(date);
  }

  const day = await fetchFrontPageForDate(date, { allowEmpty });
  if (day.items.length === 0) {
    await markSkippedRun(date, SAMPLING_METHOD, `front?day=${date} returned no parsed stories`);
    console.log(`${date}: front?day returned no parsed stories; skipped`);
    return "skipped";
  }
  await writeRawDay(day);
  await createFetchedRun(date, day.samplingMethod);
  console.log(`${date}: fetched ${day.items.length} HN front-page stories with top comments`);
  return "ready";
}

async function writeFailedFetchRun(date: string, error: unknown): Promise<RunFile> {
  const createdAt = nowIso();
  await writeRun({
    date,
    samplingMethod: SAMPLING_METHOD,
    state: "failed",
    createdAt,
    updatedAt: createdAt,
    responses: {},
    error: error instanceof Error ? error.message : String(error),
  });
  return readRun(date);
}

async function processDate(date: string, options: { force: boolean; allowEmpty: boolean }): Promise<RunFile> {
  if (!options.force && await hasCompleteNewDailyResult(date)) {
    console.log(`${date}: complete new-method daily result already exists`);
    if (!(await pathExists(runPath(date)))) {
      await createFetchedRun(date, SAMPLING_METHOD);
      await writeRun({
        ...(await readRun(date)),
        state: "complete",
      });
    }
    return readRun(date);
  }
  try {
    const rawState = await ensureFrontPageRaw(date, options.force, options.allowEmpty);
    if (rawState === "skipped") return readRun(date);
    const run = await analyzeDay(date, { force: options.force });
    if (run.state === "failed") throw new Error(`${date} failed: ${run.error ?? "unknown error"}`);
    return await readRun(date);
  } catch (error) {
    if (await pathExists(runPath(date))) {
      const run = await readRun(date);
      if (run.state === "failed") return run;
    }
    return writeFailedFetchRun(date, error);
  }
}

function printCost(cost: RunCost): void {
  console.log(`${cost.date}: Responses ${formatUsd(cost.standardUsd)}`);
  for (const stage of cost.stages) {
    if (stage.totalTokens === 0) continue;
    const cached = stage.cachedInputTokens ? `, ${stage.cachedInputTokens} cached input` : "";
    console.log(`  ${stage.stage}: ${stage.inputTokens} input${cached}, ${stage.outputTokens} output -> ${formatUsd(stage.standardUsd)}`);
  }
}

function parseConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SYNC_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1) throw new Error("--concurrency must be a positive integer");
  return value;
}

export async function runSync(options: SyncOptions): Promise<void> {
  const dates = expandDateRange(options.start, options.end);
  const concurrency = parseConcurrency(options.concurrency);
  let totalStandard = 0;

  console.log(`Syncing ${rangeLabel(dates)} with front?day story/comment snapshots at concurrency ${concurrency}`);
  if (options.noPublish) console.log("Publishing is handled outside the sync command; --no-publish accepted for compatibility.");

  const results = await mapWithConcurrency(dates, concurrency, async (date): Promise<SyncResult> => {
    console.log(`\n=== ${date} ===`);
    const run = await processDate(date, {
      force: Boolean(options.force),
      allowEmpty: Boolean(options.allowEmptyEndDate && date === options.end),
    });
    const cost = calculateRunCost(run);
    if (run.state === "complete") console.log(`${date}: analysis complete`);
    else console.log(`${date}: ${run.state}${run.error ? ` (${run.error})` : ""}`);
    if (run.state === "failed" && !options.continueOnError) {
      throw new Error(`${date} failed: ${run.error ?? "unknown error"}`);
    }
    return { date, run, cost };
  });

  for (const result of results) {
    totalStandard += result.cost.standardUsd;
    printCost(result.cost);
  }

  await buildSite();
  const failed = results.filter((result) => result.run.state === "failed");
  const skipped = results.filter((result) => result.run.state === "skipped");
  console.log(`\nTotal Responses cost: ${formatUsd(totalStandard)}`);
  if (skipped.length > 0) console.log(`Skipped dates: ${skipped.map((result) => result.date).join(", ")}`);
  if (failed.length > 0) {
    const message = `Failed dates: ${failed.map((result) => result.date).join(", ")}`;
    if (options.continueOnError) console.warn(message);
    else throw new Error(message);
  }
}

export async function runDailySync(options: DailySyncOptions = {}): Promise<void> {
  const syncEndDate = localDate();
  const latest = await latestContiguousCompletedDate(syncEndDate);
  const syncStartDate = options.force ? NEW_METHOD_START_DATE : latest ? nextDate(latest) : NEW_METHOD_START_DATE;
  if (syncStartDate > syncEndDate) {
    console.log(`No new dates to sync through ${syncEndDate}`);
    await buildSite();
    return;
  }
  const concurrency = options.concurrency;
  await runSync({
    start: syncStartDate,
    end: syncEndDate,
    force: Boolean(options.force),
    continueOnError: true,
    allowEmptyEndDate: true,
    ...(concurrency === undefined ? {} : { concurrency }),
  });
}

export async function runBackfill(options: SyncOptions): Promise<void> {
  await runSync(options);
}
