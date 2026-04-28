# HN AI Lab Sentiment

Static GitHub Pages tracker for daily Hacker News sentiment toward OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The live workflow captures the HN front page at 9pm America/Los_Angeles time. Historical backfills use Algolia HN date search and are stored as `algolia_date_search` samples, not exact historical front-page snapshots.

## Setup

1. Add the repository secret `OPENAI_API_KEY` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.
2. Enable GitHub Pages:
   `Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`.
3. Run `Daily HN snapshot` manually from the Actions tab with `force=true`.
4. Run `Finalize pending sentiment runs` manually until the run reaches `complete`.
5. Open the Pages URL shown by the finalizer deployment.

The daily workflow is scheduled for 9pm America/Los_Angeles. The workflow has two UTC cron entries and a time gate so it works across daylight-saving changes.

For a non-code overview of how posts are gathered, entities are matched, sentiment is routed, and winners are picked, see `docs/process.md`.

## Backfill February and March 2026

Use the `Backfill HN sentiment range` workflow from the GitHub Actions tab:

```text
start_date: 2026-02-01
end_date:   2026-03-31
force:      false
```

That workflow fetches historical HN stories/comments using Algolia date search and submits entity-detection batches. The `Finalize pending sentiment runs` workflow runs every 30 minutes, but you can also trigger it manually to move faster. It will poll entity batches, submit sentiment batches, poll those, adjudicate completed days, and redeploy the site.

Backfilled days are marked as `algolia_date_search`, not exact 9pm front-page snapshots.

## Local commands

```bash
npm ci
export OPENAI_API_KEY=sk-...
npm run fetch:hn -- --date 2026-04-28
npm run batch:entity -- --date 2026-04-28
npm run batch:poll
npm run batch:sentiment -- --date 2026-04-28
npm run finalize:day -- --date 2026-04-28
npm run build:site
```

To re-run only the final adjudication for an already completed day:

```bash
npm run finalize:day -- --date 2026-04-28 --force
```

To re-run entity detection and sentiment analysis from an existing raw snapshot:

```bash
export OPENAI_API_KEY=sk-...
npm run reprocess:day -- --date 2026-04-28
npm run batch:poll
npm run batch:sentiment
npm run batch:poll
npm run finalize:day -- --date 2026-04-28 --force
npm run build:site
```

The same reset can be started from GitHub Actions with the `Reprocess existing HN sentiment day` workflow.

Backfill:

```bash
export OPENAI_API_KEY=sk-...
npm run backfill:hn -- --start 2026-02-01 --end 2026-03-31
npm run batch:entity
npm run batch:poll
npm run batch:sentiment
npm run batch:poll
npm run finalize:day
npm run build:site
```

## Data model

Final daily records are written to `data/daily/YYYY-MM-DD.json`. Each record stores:

- the winner
- per-entity score, counts, confidence, and judgement snippet
- a day-level judgement snippet
- evidence IDs and HN links
- model snapshots, prompt versions, aggregation version, and sampling method

Judgement snippets cite evidence using `[E1]` tokens. The UI converts those tokens to HN links from the stored evidence array.
