import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { calculateRunCost, formatUsd, type RunCost } from "./cost.js";
import { fetchHistoricalFrontPage } from "./hn.js";
import {
  dailyPath,
  pathExists,
  rawPath,
  readRun,
  responseDir,
  ROOT,
  runPath,
  writeRawDay,
} from "./io.js";
import { createFetchedRun, processDay } from "./responses.js";
import { buildSite } from "./site.js";
import type { RunFile, SamplingMethod } from "./types.js";

const execFile = promisify(execFileCallback);

export type AnalysisBackendName = "responses";

type AnalysisBackend = {
  name: AnalysisBackendName;
  processDay(date: string): Promise<RunFile>;
};

type BackfillOptions = {
  start: string;
  end: string;
  force?: boolean;
  backend?: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
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

export function analysisBackend(name = "responses"): AnalysisBackend {
  if (name !== "responses") throw new Error(`Unsupported analysis backend: ${name}`);
  return {
    name: "responses",
    processDay: processWithResponses,
  };
}

async function runCommand(file: string, args: string[], options: { allowExitCode?: number } = {}): Promise<CommandResult> {
  try {
    const result = await execFile(file, args, {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
    });
    return result;
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

async function requireCleanWorktree(): Promise<void> {
  const { stdout } = await runCommand("git", ["status", "--porcelain"]);
  if (stdout.trim()) throw new Error(`Working tree is not clean:\n${stdout}`);
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
  await fs.rm(responseDir(date), { recursive: true, force: true });
}

async function ensureHistoricalRaw(date: string, force: boolean): Promise<void> {
  if (force) await resetGeneratedDate(date);
  if (await pathExists(rawPath(date))) {
    if (!(await pathExists(runPath(date)))) {
      await createFetchedRun(date, "historical_frontpage_snapshot" satisfies SamplingMethod);
    }
    console.log(`${date}: using existing raw snapshot`);
    return;
  }

  const day = await fetchHistoricalFrontPage(date);
  await writeRawDay(day);
  await createFetchedRun(date, day.samplingMethod);
  console.log(`${date}: fetched ${day.items.length} historical HN items`);
}

async function processWithResponses(date: string): Promise<RunFile> {
  while (true) {
    await processDay(date);
    const run = await readRun(date);
    if (run.state === "complete") return run;
    if (run.state === "failed") throw new Error(`${date} failed: ${run.error ?? "unknown error"}`);
    console.log(`${date}: ${run.state}; continuing`);
  }
}

function printCost(cost: RunCost): void {
  console.log(`${cost.date}: Responses ${formatUsd(cost.standardUsd)}; Batch estimate ${formatUsd(cost.batchEstimateUsd)}`);
  for (const stage of cost.stages) {
    if (stage.totalTokens === 0) continue;
    const cached = stage.cachedInputTokens ? `, ${stage.cachedInputTokens} cached input` : "";
    console.log(`  ${stage.stage}: ${stage.inputTokens} input${cached}, ${stage.outputTokens} output -> ${formatUsd(stage.standardUsd)}`);
  }
}

async function commitAndPublish(date: string): Promise<void> {
  await buildSite();
  const paths = [
    rawPath(date),
    runPath(date),
    dailyPath(date),
    responseDir(date),
  ].map((filePath) => path.relative(ROOT, filePath));

  await runCommand("git", ["add", "--", ...paths]);
  if (!(await hasStagedChanges())) {
    console.log(`${date}: no data changes to commit`);
    return;
  }

  await runCommand("git", ["commit", "-m", `Backfill HN sentiment ${date}`]);
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
  console.log(`${date}: published via workflow run ${runId}`);
}

export async function runBackfill(options: BackfillOptions): Promise<void> {
  const dates = expandDateRange(options.start, options.end);
  const backend = analysisBackend(options.backend ?? "responses");
  let totalStandard = 0;
  let totalBatchEstimate = 0;

  await requireCleanWorktree();
  console.log(`Backfilling ${dates[0]} through ${dates[dates.length - 1]} with ${backend.name}`);

  for (const date of dates) {
    await requireCleanWorktree();
    console.log(`\n=== ${date} ===`);
    await ensureHistoricalRaw(date, Boolean(options.force));
    const run = await backend.processDay(date);
    const cost = calculateRunCost(run);
    totalStandard += cost.standardUsd;
    totalBatchEstimate += cost.batchEstimateUsd;
    printCost(cost);
    await commitAndPublish(date);
  }

  console.log(`\nTotal Responses cost: ${formatUsd(totalStandard)}`);
  console.log(`Total Batch estimate: ${formatUsd(totalBatchEstimate)}`);
}
