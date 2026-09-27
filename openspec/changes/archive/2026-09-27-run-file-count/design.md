# Design

## Context

`runPool` in `src/orchestrator/scheduler.ts` already takes `shouldStop`. Once it returns true, no new file is handed
out and files in flight finish. `runner.ts` uses it for `retry.onFail: stop` through `control.stopped`, which also
sets `RunSummary.stopped`, and that makes the CLI exit with 3. `src/cli.ts` already has a `positiveInt` parser for
`--workers`.

## Goals / Non-Goals

**Goals:**

- A per-run file limit that reuses the pool's stop condition, with no second scheduling path.

**Non-Goals:**

- More than one named file per run. One path, or a count.
- A config option for the limit. It is a per-invocation choice, like `--fresh`.

## Decisions

- **`--files` parsed in `cli.ts` into `FileSelection`: `{ kind: 'count'; n } | { kind: 'all' } | { kind: 'path';
file }`.** Digits give a count; `0` or a negative number throws commander's `InvalidArgumentError`, like
  `positiveInt`. `all` gives all. Anything else is a path, normalised to POSIX form relative to the target (a
  leading `./` is dropped). The value goes to `runModernizer` as
  `RunOptions.files`. The `run` command defaults to `{ kind: 'count', n: 1 }`; `runModernizer` itself, when called
  without `files`, takes every file, so programmatic callers and tests keep their behaviour. It lives in `RunOptions`, not in the config, so `parseConfig` is not bypassed:
  it is not configuration.
- **The limit counts started files.** The runner increments `started` at the top of `work(file)`. `shouldStop` becomes
  `() => control.stopped || started >= limit`. That caps starts exactly, also with several workers, because
  `runPool` checks `shouldStop` before each start. A failed file counts: it used the run's time and tokens.
- **Limit is not a stop.** `RunSummary.stopped` stays `control.stopped` only. A new
  `RunSummary.limited: boolean` (limit reached and files remain) changes the closing line to
  `finished (limit of N reached): D done, F failed, R remaining — run again for the next`. Exit code 0.
- **A named file.** After the graph is built, the runner checks `graph.edges.has(file)`. When it is missing, `stat`
  on the path tells "not found" from "not selected by `source.include`/`exclude`", and the run throws
  `ConfigError` before preflight. When it is present, its record is removed from the state, and the pool gets a
  `Scheduler` over just `{ file: [] }`: no dependencies to wait for, one file to hand out. Summary counts still
  come from the whole graph.
- **Order.** Nothing new: the scheduler already hands out leaves first and skips settled files, so the next run
  continues where this one stopped.
  - _Alternative:_ picking the smallest files first. Rejected: it would break the leaves-first guarantee that lets a
    file use its dependencies' types.

## Risks / Trade-offs

- [Scripts and habits that expect `run` to do everything] → The default changes to 1 file, as requested. The closing
  line says how many remain and how to continue, and `--files all` restores the old behaviour.
