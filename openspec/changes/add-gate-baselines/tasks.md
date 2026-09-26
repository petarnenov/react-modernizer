# Tasks

## 1. Configuration

- [ ] 1.1 Gate command `string | { run, newErrorsOnly: tsc | eslint }`, normalised; new defaults; `{cache}` documented
- [ ] 1.2 Tests: both shapes accepted, unknown `newErrorsOnly` rejected, defaults

## 2. Baselines

- [ ] 2.1 `runCommand` full-output option; `typeErrors` / `check_types` use it
- [ ] 2.2 `src/run/baseline.ts`: tsc and eslint-unix parsers, counted keys, rename mapping, new-error text
- [ ] 2.3 Run baseline for commands without `{files}` at the tip, cached per command and tip in the run directory; progress event with the count
- [ ] 2.4 Per-file baseline for commands with `{files}` before the first step
- [ ] 2.5 `runGateCommands` compares baseline gates; a non-zero exit with no parsed errors fails as a plain command
- [ ] 2.6 Tests: legacy errors pass, one new error fails with only it, moved line not new, rename, crash fails, truncation no longer hides errors

## 3. Workspace

- [ ] 3.1 `{cache}` per worker outside the worktree, kept across runs
- [ ] 3.2 Cleanup after gates (checkout + clean, `node_modules` excluded)
- [ ] 3.3 Tests: build info removed and not committed; `{cache}` persists; `node_modules` link survives

## 4. Docs

- [ ] 4.1 README (gates section, pilot configs), example config, DECISIONS.md; `npm run verify` green
