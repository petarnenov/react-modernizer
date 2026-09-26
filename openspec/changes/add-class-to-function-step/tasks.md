# Tasks

## 1. Configuration

- [x] 1.1 Add `testCommand` and `requireTests` to `steps.class-to-function`; refuse to start when it is enabled with
      `requireTests` and `characterize-tests` is disabled; verify tests for "Converting without tests" and "Explicit
      opt-out"

## 2. Shared tools

- [x] 2.1 Move `confine`, `read_file`, `list_directory`, `run_tests` and `report_bug` to `src/steps/shared/tools.ts`;
      `characterize-tests` uses them; verify every existing characterize-tests test passes unchanged

## 3. Analysis

- [x] 3.1 `findClassComponents` with kinds and `skip`; verify tests for `Component`, `PureComponent`,
      `React.Component`, class expressions, an error boundary (both markers), and a non-React class
- [x] 3.2 `exportedNames` and the comparison message; verify tests for default, named, renamed, re-exported and
      `export *` exports, and "Export renamed"

## 4. The step

- [x] 4.1 Instructions and per-file prompt; verify a test that the system prompt states every rule in
      specs/class-to-function-step "Conversion rules" and the prompt names classes to convert and skipped ones
- [x] 4.2 `class-to-function` step: no-op without classes, `write_file` tool, post-conditions, `allowedChanges`,
      `preflight`; register it; verify end-to-end runs with a scripted model for "Function components only", "Error
      boundary", "Class component", "Attempt to edit a test" and "Class left behind", checking model calls, the
      committed file and the retry reason

## 5. Docs and checks

- [x] 5.1 Update README (enabling the step, what it will not do), docs/design.md status and DECISIONS.md; verify the
      README config passes `check-config`
- [x] 5.2 Run `npm run verify`; verify it passes
