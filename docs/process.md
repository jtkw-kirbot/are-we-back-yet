# Gathering and Analysis Process

This project turns a daily Hacker News front-page title snapshot into a simple daily winner among OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The tracker is intentionally title-only. It measures the vibe of what reached the HN front page, not the sentiment of the comment threads or linked articles.

## 1. Gather Front-Page Titles

The live daily run captures the current HN front page at 9pm America/Los_Angeles time. It fetches the first 30 story IDs from the Hacker News Firebase API, then stores the story title, HN link, URL, rank, score, and comment count.

Historical backfills use Hacker News' `front?day=YYYY-MM-DD` page to recover the first page of ranked stories for that date. The system then fetches those story records from the Firebase item API. It does not fetch comments.

## 2. Judge Titles in One Model Call

The full daily title list is sent to one OpenAI Responses request. The model identifies tracked entities and scores title-level sentiment in the same response.

Examples:

- "OpenAI launches ..." can create an OpenAI analysis.
- "Claude beats GPT on ..." can create Anthropic and OpenAI analyses.
- "GitHub Copilot raises usage prices for Claude models" should mainly count as Microsoft Copilot pricing sentiment unless the title directly blames Anthropic.
- "Show HN: An open-source harness using Gemini ..." should not automatically count as positive Gemini sentiment if the title is mainly about the harness.

The model only uses the title, URL/domain, HN link, and front-page metadata. It is told not to infer sentiment from comments, article bodies, linked pages, or outside knowledge.

## 3. Produce Evidence and Snippets

The model returns:

- title-level analyses for each relevant provider
- representative evidence items linked to HN stories
- a short judgement for each provider
- a short daily judgement
- a proposed daily winner

Snippets cite evidence with tokens such as `[E1]`. The UI turns those tokens into HN links.

## 4. Aggregate the Day

The code deterministically aggregates the model's title-level analyses into per-provider scores.

Each relevant title contributes based on:

- sentiment direction from strongly negative to strongly positive
- model confidence
- front-page rank, with higher-ranked titles weighted slightly more

A neutral prior is included so a provider with one weak positive title does not automatically beat a provider with broader but mixed coverage. This keeps the daily score somewhat volume-aware while still letting strong title framing matter.

The output stores:

- the daily winner
- each provider's score
- positive, neutral, and negative title counts
- confidence
- evidence links back to Hacker News
- short judgement snippets explaining the result

## 5. Publish

The static site is rebuilt and deployed to GitHub Pages. The homepage starts from the earliest available daily result, with each day colored by the winning provider.

Selecting a day shows a ranked provider chart, the evidence-backed daily judgement, and the per-provider title sentiment in a right-side sheet on larger screens or in a full-screen detail view on compact screens.

For UI-only changes, the publish workflow can rebuild and deploy the checked-in site without fetching Hacker News or running model analysis again.

For historical backfills, the local backfill command processes and publishes one day at a time, then prints actual Responses API cost.

## 6. Fail Safely

Before the OpenAI request, the system estimates request size with a tokenizer, compares it against the selected model's known context window, and disables API-side truncation.

The daily workflow verifies that the daily report exists before it publishes the site, so failed analysis does not deploy a misleading successful day.
