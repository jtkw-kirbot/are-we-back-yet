# HN AI Lab Sentiment

Static GitHub Pages tracker for daily Hacker News sentiment toward OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The live workflow captures the HN front page at 9pm America/Los_Angeles time. The public tracker starts on April 27, 2026.

For a non-code overview of how posts are gathered, entities are matched, sentiment is routed, and winners are picked, see [docs/process.md](docs/process.md).

## Setup

1. Add the repository secret `OPENAI_API_KEY` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.
2. Enable GitHub Pages:
   `Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`.
3. Run `Daily HN snapshot` manually from the Actions tab with `force=true`.
4. Open the Pages URL shown by the workflow deployment.

The daily workflow is scheduled for 9pm America/Los_Angeles. The workflow has two UTC cron entries and a time gate so it works across daylight-saving changes. A separate `Continue pending processing` workflow can resume interrupted or partially processed snapshots when needed; normal daily snapshots complete without a manual follow-up step.

## GitHub Actions

- `Deploy static site`: rebuilds and deploys GitHub Pages on every push to `main`, and can also be triggered manually. It does not fetch HN data or call OpenAI.
- `Daily HN snapshot`: captures the current HN front page, runs entity detection, sentiment analysis, daily adjudication, rebuilds the static site, and deploys GitHub Pages. Manual runs can set `force=true` to bypass the 9pm time gate.
- `Continue pending processing`: resumes any fetched or partially processed day, writes daily reports once sentiment is complete, rebuilds the static site, and deploys GitHub Pages. It can be enabled as a scheduled safety net or triggered manually.
- `Reprocess existing HN sentiment day`: manually clears direct Responses artifacts for one existing raw snapshot, reruns analysis, rebuilds the static site, and deploys GitHub Pages.

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

Large or interrupted snapshots may require `process:pending` to resume. Local runs default to 1000 new OpenAI row requests unless you set `RESPONSES_MAX_ROWS_PER_RUN`.

## Data model

Final daily records are written to `data/daily/YYYY-MM-DD.json`. Published records start on April 27, 2026. Each record stores:

- the winner
- per-entity score, counts, confidence, and judgement snippet
- a day-level judgement snippet
- evidence IDs and HN links
- model snapshots, prompt versions, aggregation version, and sampling method

Direct OpenAI Responses artifacts are written to `data/responses/YYYY-MM-DD/`. Row-level JSONL files store request hashes, attempts, response IDs, usage, parsed results, and quarantined failures so interrupted runs can resume without repeating successful work.

Judgement snippets cite evidence using `[E1]` tokens. The UI converts those tokens to HN links from the stored evidence array.
