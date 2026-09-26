# Proposal

## Why

The first full pilot on the real codebase failed on gates, not on the model's work:

- **Legacy errors fail every step.** The project has 2,996 TypeScript errors before any change. The `tsc` gate
  checks the whole project and exits non-zero, so every step that changes anything fails. The model then gets 20,000
  characters of other files' errors and wanders through the repository trying to fix them (460k tokens for one file).
- **Gate artifacts count as step changes.** `tsc --incremental` writes `tsconfig.tsbuildinfo` into the worktree. The
  next attempt saw the file, failed as "changed files it may not change", and the file would have been committed on
  success.
- **Truncated output hides errors.** Command output is cut to the last 20,000 characters. `js-to-ts` filters its own
  files' errors from that tail, so with thousands of project errors its own errors can fall outside it and read as
  "no type errors".

## What Changes

- A gate command can be `{ run, newErrorsOnly: tsc | eslint }`. Such a gate parses the command's errors and fails
  only on errors that are new compared with a baseline. Errors are matched by file, code or rule, and message,
  ignoring line and column, and counted, so a second identical error is new. Renamed files are matched through the
  rename.
  - For a command without `{files}`, the baseline is taken once per run at the run's base commit and reused on resume
    while the base is the same.
  - For a command with `{files}`, the baseline is taken per file before its first step, on that file. Files a step
    creates start with no errors.
  - Failure output lists only the new errors.
- New placeholder `{cache}`: a directory outside the worktree, one per worker, kept across runs of the same branch.
  For example, `--tsBuildInfoFile {cache}/tsc.tsbuildinfo` keeps `tsc --incremental` fast without writing into the
  worktree.
- After the gates run, anything they created or changed in the worktree is removed, so it is never part of a step's
  change or a commit.
- Commands whose errors are parsed (baseline gates, the type check used by `js-to-ts` and its `check_types` tool) read
  their full output, not the last 20,000 characters.
- **BREAKING (defaults only):** the default gates become:
  - `{ run: 'npx eslint --format json {files}', newErrorsOnly: eslint }`;
  - `{ run: 'npx tsc --noEmit --incremental --tsBuildInfoFile {cache}/tsc.tsbuildinfo', newErrorsOnly: tsc }`;
  - `{testRunner} --findRelatedTests {files}`.

  Plain string commands keep working exactly as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `quality-gates`: gate commands may judge only new errors against a baseline; the `{cache}` placeholder; gates
  leave nothing behind in the worktree.

## Impact

- `src/config/schema.ts` (gate command shape, defaults), `src/run/gates.ts` (full output, parsing, baseline
  comparison, cleanup), new `src/run/baseline.ts`, `src/run/transaction.ts`, `src/run/runner.ts` (run baseline,
  `{cache}`), `src/run/workspace.ts` (`clean`), `src/steps/shared/typecheck.ts`.
- Tests; README, example config, DECISIONS.md.
