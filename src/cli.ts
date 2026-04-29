import { promises as fs } from "node:fs";
import { runBackfill, runDailySync, runSync } from "./backfill.js";
import { analyzeDay, createFetchedRun, hasDailyResult } from "./analyze.js";
import { fetchFrontPageForDate } from "./hn.js";
import { parseArgs, pathExists, rawPath, runPath, writeRawDay } from "./io.js";
import { buildSite } from "./site.js";
import { isLosAngelesRunWindow, localDate } from "./time.js";

async function fetchHn(args: Record<string, string | boolean>): Promise<void> {
  const date = typeof args.date === "string" ? args.date : localDate();
  const force = Boolean(args.force);
  if (!force && await pathExists(rawPath(date))) {
    console.log(`raw snapshot already exists for ${date}; use --force to overwrite`);
    return;
  }
  const day = await fetchFrontPageForDate(date);
  await writeRawDay(day);
  await createFetchedRun(date, day.samplingMethod);
  console.log(`fetched ${day.items.length} HN front-page stories with top comments for ${date}`);
}

async function captureDay(args: Record<string, string | boolean>): Promise<void> {
  const date = typeof args.date === "string" ? args.date : localDate();
  const force = Boolean(args.force);
  if (!force && await hasDailyResult(date)) {
    console.log(`daily report already exists for ${date}; use --force to overwrite`);
    return;
  }
  const day = await fetchFrontPageForDate(date);
  await writeRawDay(day);
  await createFetchedRun(date, day.samplingMethod);
  const run = await analyzeDay(date, { force: true });
  console.log(`captured ${day.items.length} HN front-page stories with top comments for ${date}; ${run.state}`);
}

function parseConcurrencyArg(args: Record<string, string | boolean>): number | undefined {
  if (typeof args.concurrency !== "string") return undefined;
  const value = Number(args.concurrency);
  if (!Number.isInteger(value) || value < 1) throw new Error("--concurrency must be a positive integer");
  return value;
}

async function checkTimegate(args: Record<string, string | boolean>): Promise<void> {
  const force = Boolean(args.force);
  const date = typeof args.date === "string" ? args.date : localDate();
  const proceed = force || (isLosAngelesRunWindow() && !(await pathExists(runPath(date))));
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    await fs.appendFile(outputPath, `proceed=${proceed ? "true" : "false"}\n`, "utf8");
    await fs.appendFile(outputPath, `date=${date}\n`, "utf8");
  }
  console.log(proceed ? `proceeding for ${date}` : `not in run window or run already exists for ${date}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "fetch:hn":
      await fetchHn(args);
      break;
    case "capture:day":
      await captureDay(args);
      break;
    case "process:day":
      if (typeof args.date !== "string") throw new Error("process:day requires --date YYYY-MM-DD");
      console.log(`processed ${args.date}: ${(await analyzeDay(args.date, { force: Boolean(args.force) })).state}`);
      break;
    case "build:site":
      await buildSite();
      console.log("built static site in dist/");
      break;
    case "check:timegate":
      await checkTimegate(args);
      break;
    case "backfill":
      if (typeof args.start !== "string") throw new Error("backfill requires --start YYYY-MM-DD");
      if (typeof args.end !== "string") throw new Error("backfill requires --end YYYY-MM-DD");
      {
        const concurrency = parseConcurrencyArg(args);
        await runBackfill({
          start: args.start,
          end: args.end,
          force: Boolean(args.force),
          noPublish: Boolean(args["no-publish"]),
          ...(concurrency === undefined ? {} : { concurrency }),
        });
      }
      break;
    case "sync":
      if (typeof args.start !== "string") throw new Error("sync requires --start YYYY-MM-DD");
      if (typeof args.end !== "string") throw new Error("sync requires --end YYYY-MM-DD");
      {
        const concurrency = parseConcurrencyArg(args);
        await runSync({
          start: args.start,
          end: args.end,
          force: Boolean(args.force),
          noPublish: Boolean(args["no-publish"]),
          ...(concurrency === undefined ? {} : { concurrency }),
        });
      }
      break;
    case "sync:daily":
      {
        const concurrency = parseConcurrencyArg(args);
        await runDailySync({
          force: Boolean(args.force),
          ...(concurrency === undefined ? {} : { concurrency }),
        });
      }
      break;
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
