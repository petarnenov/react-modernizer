# Proposal

## Why

`characterize-tests` now writes tests, and the gates accept them as soon as they pass. Two holes remain before any
step that changes source code can be trusted:

1. **Tests that pass by testing little.** A test file with one trivial assertion passes every gate today. The safety
   net is only as good as what it covers.
2. **Later steps can weaken the net.** When `class-to-function`, `js-to-ts` or `simplify` cannot make a test pass,
   the easy way out is to delete it, skip it, or drop its assertions — and nothing stops that.

There is also a defect in the defaults: the target codebases are Create React App projects, where Jest only works
through `react-scripts test` (it supplies the Babel, jsdom and CSS-module configuration). The current defaults call
`npx jest` directly, which would fail on the first real run.

## What Changes

- **Test runner setting**: one `testRunner` (default `CI=true npx react-scripts test --watchAll=false`) used wherever
  tests run — the gate command, the `characterize-tests` step's `run_tests`, and the coverage gate — through a
  `{testRunner}` placeholder. Projects that run Jest directly set it once.
- **Coverage gate**: after a step, when the file has characterization tests, its line coverage by those tests is
  measured and must reach `gates.coverage.min` (80 by default; 0 turns the gate off). A failure names the percentage
  and the uncovered lines, so the step can add tests for exactly those.
- **Test protection**: once the step named in `gates.protectTestsFrom` (default `characterize-tests`) has written a
  file's tests, later steps may change them — rename to `.tsx`, add types — but may not delete the file, reduce the
  number of test cases or `expect` assertions, or add `.skip`, `.only`, `xit`, `xtest`, `xdescribe` or `it.todo`.
- **Steps declare the tests they write** (`producesTests`), so protection and coverage know which files to look at.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `quality-gates`: new coverage gate and test protection requirements.
- `configuration`: `testRunner`; the `characterize-tests` test command default uses it; `gates.coverage.min` 0
  disables coverage.

## Impact

- `src/config/schema.ts` — `testRunner`, `{testRunner}` in default commands, coverage defaults.
- New `src/run/coverage.ts` and `src/run/protection.ts`; `src/run/transaction.ts` runs them after each step.
- `src/steps/step.ts` — `producesTests`; `characterize-tests` implements it and uses `{testRunner}`.
- `src/run/workspace.ts` — staged renames report their source path, so a renamed test file is followed.
- No new dependency: coverage is read from Jest's own JSON reports; test cases and assertions are counted with the
  TypeScript parser already in use.
- **Breaking for existing configs** that relied on the `npx jest` defaults: they now get `react-scripts`. A project
  that runs Jest directly sets `testRunner`.
