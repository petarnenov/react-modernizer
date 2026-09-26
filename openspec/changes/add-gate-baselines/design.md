# Design

## Context

`runGateCommands` runs command strings and treats a non-zero exit as failure. `runCommand` keeps the last 20,000
characters of output. Gates run in the worker's worktree after the step's changes are staged. `js-to-ts` filters the
type check to its files with `errorsFor`. The target has 2,996 type errors at the base and runs about 8,000 files.

## Decisions

- **Config shape.** `gates.commands` items are `string | { run: string; newErrorsOnly: 'tsc' | 'eslint' }` in zod.
  They are normalised to one internal type, so every other place sees `{ run, newErrorsOnly? }`.
- **Parsers** (`src/run/baseline.ts`):
  - tsc: `^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$` plus indented continuation lines appended to the message.
  - eslint: the built-in `json` formatter (one line with an array of results). `unix` was the first choice, but
    ESLint 9 removed it from core ("The unix formatter is no longer part of core ESLint"), checked against ESLint 9.
    Only severity 2 counts, since warnings do not fail eslint. Absolute `filePath`s are made relative.

  The key is `file|code|message`, and the result is a count per key.

- **Comparison.** For each key, new = max(0, after − baseline). File paths go through the pipeline's rename map
  (`renamedTo`, the same tracking that follows produced tests) before lookup. A command that exits non-zero with zero
  parsed errors fails as a plain command, so a crash is never read as "no new errors".
- **When baselines are taken:**
  - Commands without `{files}`: once per run, in worker 1's fresh worktree at the tip, before the first file. The
    result is stored as `baselines/<sha256(command)>-<tip>.json` in the run directory, so a resume at the same tip
    skips it and a new tip re-takes it.
  - Commands with `{files}`: in `processFile` right after the worktree reset, on the file being processed. That is
    one extra eslint run per file (~1 s).

  Both are reported as `phase` / `gate-end` progress events with the error count.

- **Full output** for parsed commands: `runCommand(..., { keep: 'all' })` collects up to 64 MB, well beyond tsc on
  8,000 files. Display text stays truncated. `typeErrors` / `check_types` use the full output. This fixes the hidden
  errors in `js-to-ts` without changing its interface.
- **`{cache}`**: `<temp>/react-modernizer/<repo>-<id>/<branch>/cache/w<N>`, next to the worktrees (same rules: not
  under `.git` or `node_modules`). It is kept after the run, so the next run of the branch starts warm.
- **Cleanup after gates**: the step's result is in the index (staged before the gates). After the gates, run
  `git checkout -- .` and `git clean -fd -- . ':(exclude,glob)**/node_modules'` in the worktree's target directory.
  Ignored files (`-x` is not used) are left alone, since they can never be staged.
- **Defaults** change to the baseline forms (see the proposal). An explicit string command keeps its old meaning, so
  existing configs are unaffected unless they relied on the default list.

## Risks / Trade-offs

- **Key without line numbers** can hide a new error identical in text to an existing one in the same file. Counting
  catches most of these; the rest are rare and still type-correct code.
- The run baseline is taken at the base; errors fixed by accepted files lower the real count. A later file could
  reintroduce such an error without failing. Acceptable: the base never gets worse than it started.
- The first run pays one full `tsc` (~20 s here) before the first file.
