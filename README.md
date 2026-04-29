# HN AI Lab Sentiment

Static GitHub Pages tracker for daily Hacker News front-page sentiment toward OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The live workflow captures the HN front page at 9pm America/Los_Angeles time. Each daily report is based on the 30 front-page stories visible in that snapshot plus the top five top-level HN comments on each story. It does not fetch linked article bodies or deeper comment threads.

For a non-code overview of how stories are gathered, judged, and published, see [docs/process.md](docs/process.md).

## Setup

1. Add the repository secret `OPENAI_API_KEY` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.
2. Enable GitHub Pages:
   `Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`.
3. Run `Daily live HN story sentiment pipeline` manually from the Actions tab with `force=true`.
4. Open the Pages URL shown by the workflow deployment.

The daily workflow is scheduled for 9pm America/Los_Angeles. The workflow has two UTC cron entries and a time gate so it works across daylight-saving changes.

## GitHub Actions

- `Daily live HN story sentiment pipeline`: captures the current HN front-page stories and their top comments, sends them to one OpenAI Responses call for a model-owned daily report, verifies the report was produced, commits `data/`, rebuilds the static site, and deploys GitHub Pages. Manual runs can set `force=true` to bypass the 9pm time gate and refetch the current live front page.
- `Publish static site`: manually rebuilds and deploys GitHub Pages from the current checked-in data and static files. Use this for UI-only changes because it does not fetch Hacker News or call OpenAI.

## Local Commands

```bash
npm ci
export OPENAI_API_KEY=sk-...
npm run capture:day -- --date 2026-04-28
npm run build:site
```

You can still run the two phases separately when debugging:

```bash
npm run fetch:hn -- --date 2026-04-28
npm run process:day -- --date 2026-04-28
```

Historical backfills use HN's `front?day=YYYY-MM-DD` page for the first page of ranked stories, then fetch those story records and their top comments from the Firebase item API. The command processes up to ten days concurrently, prints per-day costs, then commits, pushes, and publishes the completed range once:

```bash
npm run backfill -- --start 2026-04-20 --end 2026-04-26
```

The backfill command requires a clean git worktree, authenticated `gh` CLI, and `OPENAI_API_KEY`. It prints per-day and total Responses API cost.
Historical HN requests are lightly staggered and retried for transient `429`, `502`, `503`, and `504` responses.
The final GitHub publish step retries transient `github.com` and GitHub API transport failures, including common port `443` connection timeouts. Permanent errors such as merge conflicts or authentication failures still fail immediately.

## Data Model

Final daily records are written to `data/daily/YYYY-MM-DD.json`. The UI starts its grid from the earliest daily record included in `data/index.json`. Each record stores:

- the winner, or `null` when no tracked provider had relevant HN signal
- model-judged per-entity score, relevant story counts, confidence, and judgement snippet
- `N/A` score values for providers without relevant HN stories or comments
- a day-level judgement snippet
- evidence IDs and HN links
- model snapshot, prompt version, aggregation version, and sampling method

Raw story/comment snapshots are written to `data/raw/YYYY-MM-DD.json`. Run files in `data/runs/YYYY-MM-DD.json` store token usage for the single analysis call so backfills can report actual cost.

The model owns the final scores and winner. Code validates that the winner matches the highest score, daily judgement text names that winner first, counts are internally consistent, ranked providers have evidence, and snippets cite known evidence using `[E1]` tokens. The UI converts those tokens to HN links from the stored evidence array.
