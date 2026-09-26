# Tasks

## 1. Configuration

- [ ] 1.1 Set `model.default` to `claude-opus-5`, add `model.effort`, and the `characterize-tests` options
      `testCommand` and `helpers`; update the example config; verify config tests for "Defaults", "Per-step model"
      and "Invalid effort"

## 2. Run loop extensions

- [ ] 2.1 Extend `StepContext` with `usage` and `report`, `Step` with optional `allowedChanges` and `preflight`;
      the transaction enforces allowed changes before the gates and returns usage and bugs; verify tests for "Other
      file changed anyway" and "Failed file still counts" with fake steps
- [ ] 2.2 Record usage and bugs in the state; show total tokens and reported bugs in `status`; call `preflight` for
      enabled steps before the first file; verify tests for "Status after a run with a reported bug" and a failing
      preflight that processes no file

## 3. Model access

- [ ] 3.1 Add `@anthropic-ai/sdk` 0.128.0 and record it in DECISIONS.md; verify `npm ci` and the build
- [ ] 3.2 `ModelClient` interface, `UsageMeter` with the per-file budget, shared requests-per-minute limiter; verify
      tests for "Two workers at a limit of one per minute" (fake clock) and "Runaway step"
- [ ] 3.3 Anthropic implementation: `check` via `models.retrieve`, `runTools` over the tool runner with rate limit,
      usage metering, refusal handling, adaptive thinking, effort, prompt caching and refusal fallbacks; verify it
      type-checks against the SDK and that tests for "No credentials" and "Declined request" pass with a stubbed SDK
      client

## 4. The step

- [ ] 4.1 Tools: `read_file`, `list_directory`, `write_test_file`, `run_tests`, `report_bug` with path confinement
      (realpath, no `node_modules`, `.git` or `.env*`); verify tests for "Attempt to edit the source", "Path outside
      the target" and a symlink escape
- [ ] 4.2 Instructions and per-file message; verify tests that the system prompt contains every rule in
      specs/characterize-tests-step "Tests describe behaviour", names configured helpers ("Configured helper"), and
      that retries carry the previous failure
- [ ] 4.3 `characterize-tests` step and `createBuiltInSteps`; wire into the CLI; verify an end-to-end run on a temp
      repository with a scripted model that writes a passing test ("Component with no tests"), one that keeps an
      existing test untouched ("Existing tests are left alone"), one that writes a snapshot ("Snapshot shortcut"),
      and one that reports a bug ("Off-by-one in a component")

## 5. Docs and checks

- [ ] 5.1 Update README (credentials, cost, how to pilot on a few files), docs/design.md status and DECISIONS.md;
      verify the README commands
- [ ] 5.2 Run `npm run verify`; verify it passes
