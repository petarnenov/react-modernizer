# Design

## Context

`measure(file, text).lines` in `src/steps/simplify/metrics.ts` counts the non-empty lines of the normalised code:
the TypeScript printer's output, with comments and formatting removed. `analyze` and `simplify` already use it for
their `minLines` thresholds. The runner's `work(file)` counts `begun` against the `--files` limit, then calls
`processFile`.

## Decisions

- **Check in `work`, before `processFile`,** reading the file from the worker's worktree, which is at the run
  branch's tip. A skipped file never touches gates, steps or the model. It is recorded `done` with `attempts: 0`, no
  commit and no usage.
- **Not counted:** `begun` is incremented only after the check, so `--files n` means n files with code.
- **The worktree is still taken and returned,** keeping the pool's bookkeeping unchanged. The check costs one file
  read and one parse.
- _Alternative:_ remove such files from the import graph at discovery. Rejected: `plan` and the dependency order
  should still show them, and dependents must see them as settled.

## Risks / Trade-offs

- [A file with only directives such as `'use strict'`] → That is code to the printer and is not skipped. Harmless.
