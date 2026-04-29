# Gathering and Analysis Process

This project turns each dated Hacker News front page into an auditable sentiment ranking for OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

The tracker measures the vibe of HN front-page stories and the top visible discussion under each story. It does not read linked article bodies or full comment trees.

## 1. Gather Front-Page Stories

Daily sync and manual backfills use the same Hacker News source:

```text
https://news.ycombinator.com/front?day=YYYY-MM-DD
```

For each date, the snapshot stores the first 30 front-page stories and the top 10 top-level comments on each story. Story and comment records come from the Hacker News Firebase item API. Comments posted after the end of the target date in America/Los_Angeles are ignored.

Each raw snapshot stores:

- title
- HN link
- outbound URL/domain
- front-page rank
- story score and comment count
- top 10 top-level HN comments, when available

## 2. Detect Evidence

The first OpenAI Responses call is defined in [`src/prompts.ts`](../src/prompts.ts) as `evidenceDetectionRequestBody`.

The model receives every story as a complete unit: title, URL/domain, HN URL, metadata, top comments, the fixed target list, and alias hints. It identifies only accepted source-backed evidence from titles and comments.

Evidence can be attributed through:

- explicit aliases
- story title context
- URL/domain context
- clear coreference such as "this model" or "the company"
- confidently inferred model or product aliases

A single excerpt can annotate multiple targets when the same title or comment compares providers. Generic AI sentiment, article-quality discussion, benchmark-methodology discussion, or wrapper-tool criticism is omitted unless the text clearly assigns sentiment to a tracked target.

## 3. Aggregate in Code

The model does not choose a winner or final numeric score. Code validates the evidence and computes the ranking deterministically.

Aggregation applies:

- title and comment weights
- relevance multipliers
- a per-story influence cap
- shrinkage toward neutral for low support
- support and confidence labels
- bucket labels
- rank ties and primary-signal ties

The public ranking is ordered from most negative to most positive. Providers with no accepted evidence are excluded from the ranking and listed as unmentioned.

## 4. Summarize the Day

The second OpenAI Responses call is defined in [`src/prompts.ts`](../src/prompts.ts) as `dailySummaryRequestBody`.

The model receives the already-aggregated result and approved evidence only. It writes a short headline summary and one short summary per ranked target. Summaries cite source excerpts with `[E1]` tokens; the UI turns those tokens into HN links.

This call cannot change rankings, buckets, support, confidence, or evidence membership.

## 5. Validate the Output

Before writing a daily result, code checks that:

- evidence references real titles or comments
- excerpts are substrings of the source text after whitespace normalization
- target ids and enum fields are valid
- stance labels match stance values
- one evidence record does not duplicate a target annotation
- every ranked target has evidence
- unmentioned targets are not ranked
- summaries cite known evidence ids instead of raw URLs

A deterministic alias audit also scans titles and comments for obvious missed aliases. Audit hits are stored in run metadata for review and prompt improvement; they do not affect aggregation.

## 6. Publish

The static site is rebuilt from new-method daily records and deployed to GitHub Pages.

The calendar is colored by the strongest positive adjusted provider signal for the date. If positive signals are tied within the tie threshold, the tile shows horizontal color bands. Days without a positive adjusted signal use the neutral styling.

Selecting a day shows:

- headline summary
- ranking from most negative to most positive
- bucket, support, and confidence labels
- evidence balance
- rank notes for low support, ties, or high-volume mixed signals
- unmentioned providers
- source excerpts with HN links
- per-target annotations under each excerpt

For UI-only changes, the publish workflow rebuilds and deploys the checked-in site without fetching Hacker News or calling OpenAI.

## 7. Fail Safely

Before each OpenAI request, the system estimates request size with a tokenizer, compares it against the selected model's known context window, and disables API-side truncation.

Scheduled sync catches up from the latest contiguous completed date. If one date fails, the run records the failure, continues later dates, commits successful dates, and retries the skipped date on a later scheduled sync.
