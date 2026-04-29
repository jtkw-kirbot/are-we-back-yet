# Are We Back Yet?

Static GitHub Pages tracker for daily Hacker News front-page sentiment toward OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

Each daily report is based on the 30 stories from `https://news.ycombinator.com/front?day=YYYY-MM-DD` plus the top 10 top-level HN comments on each story. It does not fetch linked article bodies or deeper comment threads.

For a non-code overview of how stories are gathered, judged, and published, see [docs/process.md](docs/process.md).

## Setup

1. Add the repository secret `OPENAI_API_KEY` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.
2. Enable GitHub Pages:
   `Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`.
3. Run `Daily HN sentiment sync` manually from the Actions tab.
4. Open the Pages URL shown by the workflow deployment.

The daily workflow runs from the latest contiguous completed date through today in America/Los_Angeles. If Hacker News has not produced a dated front page yet, that end date is skipped without failing the whole sync.

## GitHub Actions

- `Daily HN sentiment sync`: runs `npm run sync:daily`, rebuilds the static site, commits generated `data/` changes, rebases, pushes, and deploys GitHub Pages.
- `Publish static site`: manually rebuilds and deploys GitHub Pages from the current checked-in data and static files. Use this for UI-only changes because it does not fetch Hacker News or call OpenAI.

## Local Commands

```bash
npm ci
export OPENAI_API_KEY=sk-...
npm run sync -- --start 2026-04-20 --end 2026-04-26 --no-publish
npm run build:site
```

Daily catch-up sync:

```bash
npm run sync:daily
```

Single-day debugging still works:

```bash
npm run fetch:hn -- --date 2026-04-28
npm run process:day -- --date 2026-04-28 --force
```

`npm run backfill` remains as a compatibility alias for `sync`:

```bash
npm run backfill -- --start 2026-04-20 --end 2026-04-26 --no-publish
```

The sync command prints per-day and total Responses API cost. Historical HN requests are lightly staggered and retried for transient `429`, `502`, `503`, and `504` responses.

## Data Model

Final daily records are written to `data/daily/YYYY-MM-DD.json`. The UI starts its grid from the earliest new-method daily record included in `data/index.json`.

Each record stores:

- ranking from most negative to most positive
- bucket, support, confidence, raw mean, and adjusted mean for ranked targets; numeric scores are stored for audit/debugging and are not displayed in the UI
- highest adjusted signal target, or tied highest adjusted signal targets, for calendar coloring
- unmentioned targets excluded from the ranking
- source-backed evidence excerpts and HN links
- per-evidence target annotations
- model snapshots, prompt versions, aggregation version, and sampling method

Raw story/comment snapshots are written to `data/raw/YYYY-MM-DD.json`. Run files in `data/runs/YYYY-MM-DD.json` store token usage for the evidence detection and daily summary calls, plus deterministic audit counts.

The model identifies evidence and writes cited summaries. Code validates source excerpts and computes ranking, buckets, support, confidence, and ties deterministically.
