# Proposal

## Why

Every step is built and tested, but only with a scripted model and stand-in commands. The next move is a pilot on a
real codebase, and the README has only a short note on piloting one step. People need the whole path: prerequisites,
preparing the target, choosing files, a cheap first phase that changes no code, the full phase, what to review, how to
recover, and what to report back.

## What Changes

- A "Pilot, step by step" section in the README, near the top: prerequisites, install, preparing the target,
  credentials, choosing a mix of 10–15 files with `plan`, phase 1 (`analyze` + `characterize-tests`, no source
  changes, `tsc` left out of the gates without a `tsconfig.json`), phase 2 (the conversions on a new run branch),
  what to review in each, restarting and cleaning up, and what to send back.
- The short pilot note under `characterize-tests` points to that section instead of repeating it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Documentation only; `skip_specs: true`.

## Impact

- `README.md` only.
