import { promises as fs } from "node:fs";
import { runBackfill } from "./backfill.js";
import { fetchFrontPage } from "./hn.js";
import { parseArgs, pathExists, rawPath, runPath, writeRawDay } from "./io.js";
import { createFetchedRun, processDay } from "./responses.js";
import { buildSite } from "./site.js";
import { isLosAngelesRunWindow, localDate } from "./time.js";

async function fetchHn(args: Record<string, string | boolean>): Promise<void> {
  const date = typeof args.date === "string" ? args.date : localDate();
  const force = Boolean(args.force);
  if (!force && await pathExists(rawPath(date))) {
    console.log(`raw snapshot already exists for ${date}; use --force to overwrite`);
    return;
  }
  const day = await fetchFrontPage(date);
  await writeRawDay(day);
  await createFetchedRun(date, day.samplingMethod);
  console.log(`fetched ${day.items.length} HN items for ${date}`);
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
    case "process:day":
      if (typeof args.date !== "string") throw new Error("process:day requires --date YYYY-MM-DD");
      console.log(await processDay(args.date, { force: Boolean(args.force) }) ? `processed ${args.date}` : `${args.date} did not need processing`);
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
      await runBackfill({
        start: args.start,
        end: args.end,
        force: Boolean(args.force),
        ...(typeof args.backend === "string" ? { backend: args.backend } : {}),
      });
      break;
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
