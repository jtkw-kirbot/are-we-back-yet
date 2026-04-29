# HN AI Lab Sentiment

Static GitHub Pages tracker for daily Hacker News sentiment toward OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The live workflow captures the HN front page at 9pm America/Los_Angeles time. Historical backfills use Algolia HN date search and are stored as `algolia_date_search` samples, not exact historical front-page snapshots.

For a non-code overview of how posts are gathered, entities are matched, sentiment is routed, and winners are picked, see [docs/process.md](docs/process.md).

## Setup

1. Add the repository secret `OPENAI_API_KEY` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.
2. Enable GitHub Pages:
   `Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`.
3. Run `Daily HN snapshot` manually from the Actions tab with `force=true`.
4. Open the Pages URL shown by the workflow deployment.

The daily workflow is scheduled for 9pm America/Los_Angeles. The workflow has two UTC cron entries and a time gate so it works across daylight-saving changes. A separate `Continue pending processing` workflow runs every 30 minutes as a safety net for interrupted runs, rate limits, and larger backfills; normal daily snapshots complete without a manual follow-up step.

## GitHub Actions

- `Daily HN snapshot`: captures the current HN front page, runs entity detection, sentiment analysis, daily adjudication, rebuilds the static site, and deploys GitHub Pages. Manual runs can set `force=true` to bypass the 9pm time gate.
- `Continue pending processing`: resumes any fetched or partially processed day, writes daily reports once sentiment is complete, rebuilds the static site, and deploys GitHub Pages. It runs every 30 minutes and can also be triggered manually.
- `Backfill HN sentiment range`: manually fetches a historical date range using Algolia HN date search. It stores raw snapshots as `fetched`; the pending workflow processes them.
- `Reprocess existing HN sentiment day`: manually clears direct Responses artifacts for one existing raw snapshot, reruns analysis, rebuilds the static site, and deploys GitHub Pages.

## Backfill a date range

Use the `Backfill HN sentiment range` workflow from the GitHub Actions tab.

Example for February and March 2026:

```text
start_date: 2026-02-01
end_date:   2026-03-31
force:      false
```

That workflow fetches historical HN stories/comments using Algolia date search. The `Continue pending processing` workflow runs every 30 minutes and advances those days through direct OpenAI Responses processing. You can also trigger `Continue pending processing` manually to move faster.

Backfilled days are marked as `algolia_date_search`, not exact 9pm front-page snapshots.

## Local commands

```bash
npm ci
export OPENAI_API_KEY=sk-...
npm run fetch:hn -- --date 2026-04-28
npm run process:day -- --date 2026-04-28
npm run build:site
```

To re-run entity detection, sentiment analysis, and daily adjudication from an existing raw snapshot:

```bash
export OPENAI_API_KEY=sk-...
npm run reprocess:day -- --date 2026-04-28
npm run build:site
```

Backfill locally:

```bash
export OPENAI_API_KEY=sk-...
npm run backfill:hn -- --start 2026-02-01 --end 2026-03-31
npm run process:pending
npm run build:site
```

Large backfills may require multiple `process:pending` runs. The default processor limit is 1000 new OpenAI row requests per run and can be changed with `RESPONSES_MAX_ROWS_PER_RUN`.

## Data model

Final daily records are written to `data/daily/YYYY-MM-DD.json`. Each record stores:

- the winner
- per-entity score, counts, confidence, and judgement snippet
- a day-level judgement snippet
- evidence IDs and HN links
- model snapshots, prompt versions, aggregation version, and sampling method

Direct OpenAI Responses artifacts are written to `data/responses/YYYY-MM-DD/`. Row-level JSONL files store request hashes, attempts, response IDs, usage, parsed results, and quarantined failures so interrupted runs can resume without repeating successful work.

Judgement snippets cite evidence using `[E1]` tokens. The UI converts those tokens to HN links from the stored evidence array.
