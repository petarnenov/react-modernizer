# Proposal

## Why

`src/app/_actions/tradeHoldActions.js` in geowealth has been a single newline since 2021. A run still sent it
through every step. characterize-tests wrote a 62-line test that reads the file with `fs` to prove it is empty. Then
js-to-ts spent more than 14 minutes and two attempts fighting that test's types. There are 26 such files in the
geowealth source, mostly empty `index.js`, `_reducers/index.js` and `_hooks/index.js`. Nothing in them can be
modernized.

## What Changes

- A file with no code lines, only whitespace and comments, is settled as done and unchanged before any step, gate or
  model call. The log line is `· <file> no code, skipped`.
- Such files do not count toward `--files`, so `--files 5` still processes five files that have code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution`: a new requirement for files without code, including how they count toward `--files`.

## Impact

- `src/run/runner.ts` (the per-file `work`), reusing `measure` from `src/steps/simplify/metrics.ts`.
- `test/run.test.ts`.
