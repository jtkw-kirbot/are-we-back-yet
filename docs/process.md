# Gathering and Analysis Process

This project takes a daily snapshot of Hacker News discussion and turns it into a simple daily winner among OpenAI, Anthropic, Google Gemini, and Microsoft Copilot.

## 1. Gather the Hacker News discussion

Each daily run captures the Hacker News front page and the comments under each front-page post. The daily live run happens at 9pm America/Los_Angeles time.

## 2. Identify relevant AI entities

Each story and comment is scanned for mentions of the tracked entities and their products. This is a direct OpenAI Responses call per item, and row-level artifacts are stored for auditability.

Examples:

- "ChatGPT", "GPT", "Codex", and "Sora" point to OpenAI.
- "Claude", "Sonnet", "Opus", and "Claude Code" point to Anthropic.
- "Gemini" and "Google AI Studio" point to Google Gemini.
- "GitHub Copilot", "Bing Copilot", "Windows Copilot", and "M365 Copilot" point to Microsoft Copilot.

The entity pass also records where the mention appears. This matters because a model can be discussed inside another product.

Example:

- "Sonnet is now 9x in GitHub Copilot" mentions an Anthropic model, but the surface being judged is GitHub Copilot.

## 3. Decide who owns the sentiment

The system separates the underlying model owner from the product surface that packages or sells access to the model.

Examples:

- "Claude gives better answers than GPT for this codebase" is about Anthropic and OpenAI model quality.
- "Claude API prices are too high" is about Anthropic provider pricing.
- "Sonnet now costs 9x in GitHub Copilot" is mainly about Microsoft Copilot billing.
- "GPT is too expensive on OpenRouter" should not automatically count as negative toward OpenAI unless the comment also criticizes OpenAI directly.
- "Gemini in this VS Code extension keeps failing" may be about the extension or integration unless the model behavior is clearly blamed.
- "This open-source harness using Gemini got great benchmark results" is not automatically positive for Gemini if the praise is for the harness, benchmark setup, or implementation technique. It should count for Gemini only when the comment clearly credits the model's quality or compares Gemini's model performance.

When the owner is ambiguous, the system should prefer a lower-confidence or neutral judgement rather than forcing negativity onto the model owner.

## 4. Score sentiment per entity

The sentiment model scores each relevant tracked entity for the item. Scores range from strongly negative to strongly positive.

The score is aspect-based. A single comment can produce separate scores for multiple entities.

Example:

- "Copilot is too expensive now, but Claude itself still works great" can be negative for Microsoft Copilot and positive for Anthropic.

## 5. Aggregate the day

All item-level scores are combined into daily per-entity scores. Higher-level story comments get more weight than deeply nested replies, and low-confidence judgements contribute less.

The output stores:

- the daily winner
- each entity's score
- positive, neutral, and negative counts
- confidence
- evidence links back to Hacker News
- a short judgement explaining the result

## 6. Adjudicate and publish

An adjudication model reviews the aggregate scores and representative evidence, chooses the daily winner, and writes the short explanation shown in the UI.

The static site is rebuilt and deployed to GitHub Pages. The homepage shows daily snapshots from April 27, 2026 onward, with each day colored by the winning entity. Selecting a day shows a ranked provider chart, the evidence-backed daily judgement, and the per-entity sentiment in a right-side sheet on larger screens, or in a full-screen detail view on compact screens.

For UI-only changes, the publish workflow can rebuild and deploy the checked-in site without fetching Hacker News or running model analysis again.

## 7. Fail safely

The processor stores row-level progress and token usage. The daily workflow verifies that the daily report exists before it publishes the site, so partial processing fails loudly instead of deploying a misleading successful day.

Before each OpenAI request, the system estimates the request size with a tokenizer, compares it against the selected model's known context window, and disables API-side truncation. Oversized or repeatedly invalid rows are quarantined instead of blocking the whole day, as long as they remain below the small daily tolerance.
