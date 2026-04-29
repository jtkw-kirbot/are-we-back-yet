import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DailyResultSchema, RawDaySchema, RunFileSchema, type DailyResult, type RawDay, type RunFile } from "./types.js";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data");
export const DOCS_DIR = path.join(ROOT, "docs");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const DAILY_DIR = path.join(DATA_DIR, "daily");
export const STATIC_DIR = path.join(ROOT, "static");
export const DIST_DIR = path.join(ROOT, "dist");

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return schema.parse(JSON.parse(content));
}

export function rawPath(date: string): string {
  return path.join(RAW_DIR, `${date}.json`);
}

export function runPath(date: string): string {
  return path.join(RUNS_DIR, `${date}.json`);
}

export function dailyPath(date: string): string {
  return path.join(DAILY_DIR, `${date}.json`);
}

export async function readRawDay(date: string): Promise<RawDay> {
  return readJson(rawPath(date), RawDaySchema);
}

export async function writeRawDay(day: RawDay): Promise<void> {
  await writeJson(rawPath(day.date), day);
}

export async function readRun(date: string): Promise<RunFile> {
  return readJson(runPath(date), RunFileSchema);
}

export async function writeRun(run: RunFile): Promise<void> {
  await writeJson(runPath(run.date), { ...run, updatedAt: new Date().toISOString() });
}

export async function writeDaily(result: DailyResult): Promise<void> {
  await writeJson(dailyPath(result.date), DailyResultSchema.parse(result));
}

export async function listJsonDates(dir: string): Promise<string[]> {
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

export async function readDailyResults(): Promise<DailyResult[]> {
  const dates = await listJsonDates(DAILY_DIR);
  const days: DailyResult[] = [];
  for (const date of dates) {
    try {
      const day = await readJson(dailyPath(date), DailyResultSchema);
      days.push(day);
    } catch (error) {
      if (error instanceof z.ZodError) continue;
      throw error;
    }
  }
  return days;
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
