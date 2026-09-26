# Tasks

## 1. Configuration

- [x] 1.1 Gate command `string | { run, newErrorsOnly: tsc | eslint }`, normalised; new defaults; `{cache}` documented
- [x] 1.2 Tests: both shapes accepted, unknown `newErrorsOnly` rejected, defaults

## 2. Baselines

- [x] 2.1 `runCommand` full-output option; `typeErrors` / `check_types` use it
- [x] 2.2 `src/run/baseline.ts`: tsc and ESLint JSON parsers, counted keys, rename mapping, new-error text
- [x] 2.3 Run baseline for commands without `{files}` at the tip, cached per command and tip in the run directory; progress event with the count
- [x] 2.4 Per-file baseline for commands with `{files}` before the first step
- [x] 2.5 `runGateCommands` compares baseline gates; a non-zero exit with no parsed errors fails as a plain command
- [x] 2.6 Tests: legacy errors pass, one new error fails with only it, moved line not new, rename, crash fails, truncation no longer hides errors

## 3. Workspace

- [x] 3.1 `{cache}` per worker outside the worktree, kept across runs
- [x] 3.2 Cleanup after gates (checkout + clean, `node_modules` excluded)
- [x] 3.3 Tests: build info removed and not committed; `{cache}` persists; `node_modules` link survives

## 4. Docs

- [x] 4.1 README (gates section, pilot configs), example config, DECISIONS.md; `npm run verify` green
