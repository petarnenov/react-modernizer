# Design

## Context

See proposal.md for why. What exists: per step, the transaction runs the step, puts back changes outside
`allowedChanges`, stages, then runs the gate commands and forbidden patterns (`src/run/transaction.ts`). The config
already has `gates.coverage.min` (80) and `gates.protectTestsFrom` (`characterize-tests`), unused. `characterize-tests`
writes `<Name>.characterization.test.<ext>`. The TypeScript parser is a runtime dependency. Staged changes report the
new path of a rename but not the old one.

## Goals / Non-Goals

**Goals:**

- A step cannot pass with thin tests, and no later step can thin them out.
- Feedback precise enough for the model to fix: which lines are uncovered, which counts dropped.
- The defaults work on a Create React App project as-is.

**Non-Goals:**

- Branch or function coverage; line coverage is the one number that is easy to act on.
- Judging test quality beyond coverage and counts (mutation testing would be the next level).
- Protecting tests that existed before the run; they are the user's, and no step writes to them anyway.

## Decisions

### 1. `testRunner` and a `{testRunner}` placeholder

Expanded when a command is used, not when the config is loaded, so `check-config` shows what the user wrote. Defaults:

```
testRunner:                    CI=true npx react-scripts test --watchAll=false
gates.commands[2]:             {testRunner} --findRelatedTests {files}
characterize-tests.testCommand: {testRunner} {testFile}
```

`react-scripts test` forwards its arguments to Jest, so `--findRelatedTests`, `--coverage` and
`--collectCoverageFrom` work through it. `CI=true` turns off watch mode and interactive output.

### 2. Coverage from Jest's JSON report, computed by us

```
{testRunner} --coverage --coverageReporters=json --coverageDirectory=<tmp> --collectCoverageFrom=<file> <tests…>
```

run in the worktree, with `<tmp>` a fresh directory under the OS temp dir (removed afterwards), so nothing lands in
the change. From `coverage-final.json` the entry for the file gives the statement map and hit counts; a line is
covered when a statement starting on it ran — the same rule Istanbul uses for its line percentage. The result is the
percentage and the uncovered lines, compacted into ranges (`12–18, 30`). A file absent from the report was never
loaded by its tests: 0%. A file without statements: 100%.

- _Alternative rejected — `json-summary`:_ gives the percentage but not which lines, and the lines are what make a
  retry useful.

Runs after the cheaper gates, under the same semaphore and timeout.

### 3. Which tests, which file

`Step` gains optional `producesTests(file): string[]`. The transaction collects, for the processed file, the test files
produced so far in its pipeline and follows renames:

- the **source file** existed at the base, so `stage()` — which now also returns a rename's source path — gives its new
  path from git's rename detection; when git sees a delete and an add instead, it is found by name (below);
- a **produced test file** did not exist at the base, so to git a `.jsx → .tsx` rename of it is just an added file.
  It is found by name: the same path with another code extension (`.js`, `.jsx`, `.ts`, `.tsx`).

Coverage measures the file's current path with its current test paths. _(Changed during implementation: the design
first assumed git's rename detection would follow the test files too; it cannot, since they are new in the run.)_

### 4. Protection by counting with the TypeScript parser

When the protected step passes for a file, the transaction records for each of its test files: test cases (calls of
`it`, `test`, and `it.each(…)(…)`/`test.each(…)(…)`), `expect(…)` calls, and "disabled" markers (`.skip`, `.only`,
`.todo` on `it`/`test`/`describe`; `xit`, `xtest`, `xdescribe`, `fit`, `fdescribe`). After every later step:

- the file (followed through renames) must exist;
- test cases and assertions must not decrease;
- disabled markers must not increase.

Counting the AST, not text, ignores comments and strings. It runs before the gate commands: it is instant and its
failure is definitive.

- _Alternative rejected — diff-based rules ("no removed `expect` lines"):_ a rename or reformatting removes and re-adds
  every line; counts are stable under both.

### 5. Order after each step

`allowed changes → protection → gate commands → forbidden patterns → coverage` — cheapest and most definitive first.

### 6. The step is told the target

`characterize-tests`' per-file prompt states the coverage minimum. The system prompt stays unchanged, so it stays
cached. A coverage failure on retry carries the uncovered lines like any gate failure.

## Risks / Trade-offs

- [`--collectCoverageFrom` through `react-scripts`] → Jest accepts it on the command line and CRA forwards
  arguments; the pilot confirms it on the real codebase, and `testRunner` plus a configurable coverage command are the
  escape hatch.
- [80% is unreachable for some files — e.g. large configuration objects or dead branches] → The failure lists the
  lines; `gates.coverage.min` can be lowered, and a later change can add per-path overrides if the pilot shows a
  pattern.
- [Coverage doubles test time per step] → It runs only when every other gate passed, and only for files with
  characterization tests.
- [A step that splits one test into two and drops an assertion keeps the case count] → Assertions are counted
  separately; both must hold.
- [Breaking default change] → Called out in the proposal and DECISIONS; `check-config` shows the effective commands.

## Open Questions

- Whether `--collectCoverageFrom` must be relative or absolute under `react-scripts` in the target; settled in the
  pilot without changing the approach.
