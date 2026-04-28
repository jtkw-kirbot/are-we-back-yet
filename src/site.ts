import { promises as fs } from "node:fs";
import path from "node:path";
import { TARGETS } from "./config.js";
import { DIST_DIR, ensureDir, readDailyResults, STATIC_DIR, writeJson } from "./io.js";
import type { SiteIndex } from "./types.js";

async function copyDir(from: string, to: string): Promise<void> {
  await ensureDir(to);
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else {
      await ensureDir(path.dirname(target));
      await fs.copyFile(source, target);
    }
  }
}

export async function buildSite(): Promise<void> {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await ensureDir(path.join(DIST_DIR, "data"));
  await copyDir(STATIC_DIR, DIST_DIR);
  await fs.writeFile(path.join(DIST_DIR, ".nojekyll"), "", "utf8");

  const index: SiteIndex = {
    generatedAt: new Date().toISOString(),
    targets: [...TARGETS],
    days: await readDailyResults(),
  };

  await writeJson(path.join(DIST_DIR, "data", "index.json"), index);
}
