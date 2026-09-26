# Tasks

## 1. Test runner

- [x] 1.1 Add `testRunner`, `gates.coverage.min` accepting 0, and `{testRunner}` defaults for the test gate and the
      `characterize-tests` test command; expand `{testRunner}` wherever commands run; update the example config;
      verify config tests for "Create React App by default", "Project that runs Jest directly" and the modified
      "Defaults"

## 2. Following files through the pipeline

- [x] 2.1 `stage()` returns the source path of renames; `Step.producesTests`; `characterize-tests` implements it;
      the transaction tracks the file's current path and its produced test paths through renames; verify a test where
      a fake step renames both the file and its test file

## 3. Test protection

- [x] 3.1 `protection.ts`: count test cases, assertions and disabled markers with the TypeScript parser; verify unit
      tests for `it`/`test`/`.each`, `expect`, every disabled marker, and that comments and strings are ignored
- [x] 3.2 Record counts when the protected step passes and check them after every later step; verify tests for
      "Deleted assertion", "Skipped test", "Converted to TypeScript", "Deleted test file", and `protectTestsFrom: null`

## 4. Coverage gate

- [x] 4.1 `coverage.ts`: build the command, run it with a temporary coverage directory, read `coverage-final.json`,
      compute line coverage and uncovered ranges; verify unit tests on recorded report fixtures for full, partial,
      absent and statement-less files, and that the temporary directory is removed
- [x] 4.2 Run the coverage gate last after each step when the file has produced tests, under the gate semaphore and
      timeout; tell `characterize-tests` the minimum in its per-file prompt; verify tests for "Enough coverage",
      "Too little coverage" (message and retry), "Renamed file" and "Coverage off", using a fake test runner that
      writes a coverage report

## 5. Docs and checks

- [x] 5.1 Update README (testRunner, coverage, protection), docs/design.md status and DECISIONS.md (the breaking
      default); verify `check-config` shows the new defaults
- [x] 5.2 Run `npm run verify`; verify it passes
