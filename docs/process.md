# Gathering and Analysis Process

This project turns a daily Hacker News front-page snapshot into a simple daily winner among OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The tracker measures the vibe of HN front-page stories and the top visible discussion under each story. It does not read linked article bodies or full comment trees.

## 1. Gather Front-Page Stories

The live daily run captures the current HN front page at 9pm America/Los_Angeles time. It fetches the first 30 story IDs from the Hacker News Firebase API.

For each story, the snapshot stores:

- title
- HN link
- outbound URL
- front-page rank
- story score and comment count
- top five top-level HN comments, when available

Historical backfills use Hacker News' `front?day=YYYY-MM-DD` page to recover the first page of ranked stories for that date. The system then fetches those story records and their top comments from the Firebase item API, filtering out comments posted after the end of the requested UTC date.

## 2. Judge Stories in One Model Call

The full daily story list is sent to one OpenAI Responses request. The model identifies tracked entities and scores story-level sentiment in the same response.

Examples:

- A title saying "OpenAI launches ..." can create an OpenAI analysis.
- A story titled "Claude beats GPT on ..." can create Anthropic and OpenAI analyses.
- A top comment saying Copilot pricing for Claude models is too high should mainly count as Microsoft Copilot pricing sentiment unless the comment directly blames Anthropic.
- A Show HN project using Gemini should not automatically count as positive Gemini sentiment if the title and comments mainly praise the harness or project.

The model only uses the story title, URL/domain, HN link, front-page metadata, and the provided top comments. It is told not to infer sentiment from article bodies, omitted comments, or outside knowledge.

## 3. Handle Missing Provider Signal

Providers without relevant HN story/comment signal for the day are stored as `N/A`.

This means:

- no numeric score
- no ranking position
- no provider judgement beyond `N/A`
- no effect on winner selection

If no tracked provider has relevant HN signal, the daily winner is `null` and the day is shown without a provider color.

## 4. Produce Evidence and Snippets

The model returns:

- story-level analyses for each relevant provider
- representative evidence items linked to HN stories
- a short judgement for each relevant provider
- a short daily judgement
- a proposed daily winner, or `null`

Snippets cite evidence with tokens such as `[E1]`. The UI turns those tokens into HN links.

## 5. Aggregate the Day

The code deterministically aggregates the model's story-level analyses into per-provider scores.

Each relevant story contributes based on:

- sentiment direction from strongly negative to strongly positive
- model confidence
- front-page rank, with higher-ranked stories weighted slightly more

A neutral prior is included so a provider with one weak positive story does not automatically beat a provider with broader but mixed coverage. Providers with no relevant stories stay `N/A` and are excluded from this calculation.

The output stores:

- the daily winner, if any
- each relevant provider's score
- positive, neutral, and negative relevant story counts
- confidence
- evidence links back to Hacker News
- short judgement snippets explaining the result

## 6. Publish

The static site is rebuilt and deployed to GitHub Pages. The homepage starts from the earliest available daily result, with each day colored by the winning provider.

Selecting a day shows a ranked provider chart, the evidence-backed daily judgement, and the per-provider sentiment in a right-side sheet on larger screens or in a full-screen detail view on compact screens.

For UI-only changes, the publish workflow can rebuild and deploy the checked-in site without fetching Hacker News or running model analysis again.

For historical backfills, the local backfill command analyzes up to ten days at a time, prints actual Responses API cost for each day, then publishes the completed range once.

## 7. Fail Safely

Before the OpenAI request, the system estimates request size with a tokenizer, compares it against the selected model's known context window, and disables API-side truncation.

The daily workflow verifies that the daily report exists before it publishes the site, so failed analysis does not deploy a misleading successful day.
