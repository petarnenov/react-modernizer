# Tasks

## 1. Configuration

- [x] 1.1 Add `lintCommand` and `minLines` to `steps.analyze`; update the example config; verify tests for "Defaults"
      and "Cheaper analysis"

## 2. Findings

- [x] 2.1 `BugReport` gains `severity` and `step`; `report_bug` accepts an optional severity; the transaction stamps
      the reporting step; verify a test that reports from two steps carry their own step names and severities
- [x] 2.2 `status` groups findings by severity with counts; verify tests for "Findings by severity" and the existing
      "Status after a run with a reported bug"

## 3. Unchanged steps

- [x] 3.0 A step attempt that changes nothing passes without the gates; the gates-only baseline is unchanged; verify
      tests for "Legacy lint errors" and "Baseline run"

## 4. The step

- [x] 4.1 Instructions and per-file prompt (file, tests, importers, lint output or its absence); verify a test that the
      system prompt states every direction and restriction in specs/analyze-step "What to look for"
- [x] 4.2 `analyze` step: size filter, lint evidence, read-only tools, `allowedChanges: []`, `preflight`; register it;
      verify end-to-end runs with a scripted model for "Read-only", "Lint warning", "No linter", "Stale closure", "Clean
      file" and "Small file skipped"

## 5. Docs and checks

- [x] 5.1 Update README (analyze, severities, cost), docs/design.md status and DECISIONS.md; verify the README config
      passes `check-config`
- [x] 5.2 Run `npm run verify`; verify it passes
