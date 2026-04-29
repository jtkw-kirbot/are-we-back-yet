# Agent Instructions

## Documentation Sync

Any change to code logic must be cross-checked against the documentation. If the change makes documentation stale, update the relevant docs in the same change.

Important docs to check include:

- `README.md`
- `docs/process.md`
- GitHub Actions setup and workflow descriptions
- setup, reprocess, and deployment instructions

## What Counts as Code Logic

Code logic includes behavior, data flow, scheduling, schemas, CLI commands, workflows, UI behavior, model prompts, aggregation, and data storage.

Documentation-only changes do not require code changes unless they reveal an existing documentation/code mismatch that should be fixed.

## Final Response

When making code logic changes, mention whether documentation was reviewed and whether any docs were updated.
