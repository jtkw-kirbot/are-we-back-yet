import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { analyzeDay, createFetchedRun } from "./analyze.js";
import { calculateRunCost, formatUsd, type RunCost } from "./cost.js";
import { fetchHistoricalFrontPage } from "./hn.js";
import {
  dailyPath,
  pathExists,
  rawPath,
  readRawDay,
  readRun,
  ROOT,
  runPath,
  writeRawDay,
} from "./io.js";
import { buildSite } from "./site.js";
import type { RunFile } from "./types.js";

const execFile = promisify(execFileCallback);
const BACKFILL_CONCURRENCY = 5;

type BackfillOptions = {
  start: string;
  end: string;
  force?: boolean;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type GitStatusEntry = {
  path: string;
  status: string;
};

type BackfillResult = {
  date: string;
  run: RunFile;
  cost: RunCost;
};

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
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

async function runCommand(file: string, args: string[], options: { allowExitCode?: number } = {}): Promise<CommandResult> {
  try {
    return await execFile(file, args, {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const maybe = error as Error & { code?: number; stdout?: string; stderr?: string };
    if (options.allowExitCode !== undefined && maybe.code === options.allowExitCode) {
      return {
        stdout: maybe.stdout ?? "",
        stderr: maybe.stderr ?? "",
      };
    }
    throw error;
  }
}

function generatedDatePaths(date: string): string[] {
  return [
    rawPath(date),
    runPath(date),
    dailyPath(date),
  ].map((filePath) => path.relative(ROOT, filePath));
}

function parseGitStatus(stdout: string): GitStatusEntry[] {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3).trim(),
    }));
}

function pathIsAllowedGenerated(pathName: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => pathName === root || pathName.startsWith(`${root}/`));
}

async function requireCleanExceptGenerated(dates: string[]): Promise<void> {
  const allowedRoots = dates.flatMap(generatedDatePaths);
  const { stdout } = await runCommand("git", ["status", "--porcelain", "--untracked-files=all"]);
  const unexpected = parseGitStatus(stdout).filter((entry) => !pathIsAllowedGenerated(entry.path, allowedRoots));
  if (unexpected.length > 0) {
    throw new Error(`Working tree has changes outside this backfill range:\n${unexpected.map((entry) => `${entry.status} ${entry.path}`).join("\n")}`);
  }
}

async function hasStagedChanges(): Promise<boolean> {
  await runCommand("git", ["diff", "--cached", "--quiet"], { allowExitCode: 1 });
  const { stdout } = await runCommand("git", ["diff", "--cached", "--name-only"]);
  return stdout.trim().length > 0;
}

async function resetGeneratedDate(date: string): Promise<void> {
  await fs.rm(rawPath(date), { force: true });
  await fs.rm(runPath(date), { force: true });
  await fs.rm(dailyPath(date), { force: true });
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
    if (result === undefined) throw new Error(`Missing backfill result at index ${index}`);
    return result;
  });
}

async function ensureHistoricalRaw(date: string, force: boolean): Promise<void> {
  if (force) await resetGeneratedDate(date);
  if (await pathExists(rawPath(date))) {
    const raw = await readRawDay(date);
    const hasStoryCommentData = raw.samplingMethod === "historical_frontpage_story_comment_snapshot" &&
      raw.items.every((item) => Array.isArray(item.topComments));
    if (hasStoryCommentData) {
      if (!(await pathExists(runPath(date)))) {
        await createFetchedRun(date, "historical_frontpage_story_comment_snapshot");
      }
      console.log(`${date}: using existing story/comment snapshot`);
      return;
    }
    console.log(`${date}: replacing older snapshot with story/comment snapshot`);
    await resetGeneratedDate(date);
  }

  const day = await fetchHistoricalFrontPage(date);
  await writeRawDay(day);
  await createFetchedRun(date, day.samplingMethod);
  console.log(`${date}: fetched ${day.items.length} historical HN front-page stories with top comments`);
}

function printCost(cost: RunCost): void {
  console.log(`${cost.date}: Responses ${formatUsd(cost.standardUsd)}`);
  for (const stage of cost.stages) {
    if (stage.totalTokens === 0) continue;
    const cached = stage.cachedInputTokens ? `, ${stage.cachedInputTokens} cached input` : "";
    console.log(`  ${stage.stage}: ${stage.inputTokens} input${cached}, ${stage.outputTokens} output -> ${formatUsd(stage.standardUsd)}`);
  }
}

function rangeLabel(dates: string[]): string {
  const first = dates[0] ?? "";
  const last = dates[dates.length - 1] ?? first;
  if (dates.length === 1) return first;
  return `${first} through ${last}`;
}

async function commitAndPublish(dates: string[]): Promise<void> {
  await buildSite();
  const paths = dates.flatMap(generatedDatePaths);

  await runCommand("git", ["add", "--", ...paths]);
  if (!(await hasStagedChanges())) {
    console.log(`${rangeLabel(dates)}: no data changes to commit`);
    return;
  }

  await runCommand("git", ["commit", "-m", `Backfill HN story sentiment ${rangeLabel(dates)}`]);
  await runCommand("git", ["pull", "--rebase", "origin", "main"]);
  await runCommand("git", ["push", "origin", "main"]);
  const { stdout: sha } = await runCommand("git", ["rev-parse", "HEAD"]);
  const headSha = sha.trim();
  const startedAt = new Date(Date.now() - 5_000).toISOString();

  await runCommand("gh", ["workflow", "run", "publish-site.yml", "--ref", "main"]);
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  let runId = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { stdout } = await runCommand("gh", [
      "run",
      "list",
      "--workflow",
      "publish-site.yml",
      "--branch",
      "main",
      "--limit",
      "10",
      "--json",
      "databaseId,createdAt,headSha",
    ]);
    const runs = JSON.parse(stdout) as Array<{ databaseId: number; createdAt: string; headSha: string }>;
    const match = runs.find((run) => run.headSha === headSha && run.createdAt >= startedAt);
    if (match) {
      runId = String(match.databaseId);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  if (!runId) throw new Error("Could not find triggered Publish static site run");

  await runCommand("gh", ["run", "watch", runId, "--exit-status"]);
  console.log(`${rangeLabel(dates)}: published via workflow run ${runId}`);
}

async function processDate(date: string): Promise<RunFile> {
  const run = await analyzeDay(date);
  if (run.state === "failed") throw new Error(`${date} failed: ${run.error ?? "unknown error"}`);
  return await readRun(date);
}

export async function runBackfill(options: BackfillOptions): Promise<void> {
  const dates = expandDateRange(options.start, options.end);
  let totalStandard = 0;

  await requireCleanExceptGenerated(dates);
  console.log(`Backfilling ${rangeLabel(dates)} with story/comment Responses analysis at concurrency ${BACKFILL_CONCURRENCY}`);

  const results = await mapWithConcurrency(dates, BACKFILL_CONCURRENCY, async (date): Promise<BackfillResult> => {
    console.log(`\n=== ${date} ===`);
    await ensureHistoricalRaw(date, Boolean(options.force));
    const run = await processDate(date);
    const cost = calculateRunCost(run);
    console.log(`${date}: analysis complete`);
    return { date, run, cost };
  });

  for (const result of results) {
    if (result.run.state !== "complete") throw new Error(`${result.date} did not complete`);
    totalStandard += result.cost.standardUsd;
    printCost(result.cost);
  }

  await requireCleanExceptGenerated(dates);
  await commitAndPublish(dates);

  console.log(`\nTotal Responses cost: ${formatUsd(totalStandard)}`);
}
