# HN AI Lab Sentiment

Static GitHub Pages tracker for daily Hacker News sentiment toward OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The live workflow captures the HN front page at 9pm America/Los_Angeles time. The public tracker starts at the earliest checked-in daily result.

For a non-code overview of how posts are gathered, entities are matched, sentiment is routed, and winners are picked, see [docs/process.md](docs/process.md).

## Setup

1. Add the repository secret `OPENAI_API_KEY` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.
2. Enable GitHub Pages:
   `Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`.
3. Run `Daily live HN sentiment pipeline` manually from the Actions tab with `force=true`.
4. Open the Pages URL shown by the workflow deployment.

The daily workflow is scheduled for 9pm America/Los_Angeles. The workflow has two UTC cron entries and a time gate so it works across daylight-saving changes.

## GitHub Actions

- `Daily live HN sentiment pipeline`: captures the current HN front page, runs entity detection, sentiment analysis, daily adjudication, verifies the daily report was produced, commits `data/`, rebuilds the static site, and deploys GitHub Pages. Manual runs can set `force=true` to bypass the 9pm time gate and refetch the current live front page.
- `Publish static site`: manually rebuilds and deploys GitHub Pages from the current checked-in data and static files. Use this for UI-only changes because it does not fetch Hacker News or call OpenAI.

## Local commands

```bash
npm ci
export OPENAI_API_KEY=sk-...
npm run fetch:hn -- --date 2026-04-28
npm run process:day -- --date 2026-04-28
npm run build:site
```

Large local live snapshots can raise the row cap with `RESPONSES_MAX_ROWS_PER_RUN`.

Historical backfills use HN's `front?day=YYYY-MM-DD` page for the first page of ranked stories, then fetch comments from the Firebase item API. The command processes, commits, pushes, and publishes one completed day at a time:

```bash
npm run backfill -- --start 2026-04-20 --end 2026-04-26
```

The backfill command requires a clean git worktree, authenticated `gh` CLI, and `OPENAI_API_KEY`. It prints per-day and total Responses cost, plus a 50% Batch API estimate for comparison. It defaults to `--backend responses`; other backends are intentionally rejected until implemented.

## Data model

Final daily records are written to `data/daily/YYYY-MM-DD.json`. The UI starts its grid from the earliest daily record included in `data/index.json`. Each record stores:

- the winner
- per-entity score, counts, confidence, and judgement snippet
- a day-level judgement snippet
- evidence IDs and HN links
- model snapshots, prompt versions, aggregation version, and sampling method

Direct OpenAI Responses artifacts are written to `data/responses/YYYY-MM-DD/`. Row-level JSONL files store request hashes, attempts, response IDs, usage, parsed results, and quarantined failures for auditability. Run files in `data/runs/YYYY-MM-DD.json` store token usage for entity detection, sentiment, and adjudication so historical backfills can report actual cost.

Judgement snippets cite evidence using `[E1]` tokens. The UI converts those tokens to HN links from the stored evidence array.
