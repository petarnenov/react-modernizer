# Tasks

## 1. Configuration

- [x] 1.1 Add `minLines`, `testCommand` and `typecheckCommand` to `steps.simplify`; update the example config; verify
      tests for "Defaults" and "Simplify everything"

## 2. Shared type checking

- [x] 2.1 Move `errorsFor` and the type-check helper to `src/steps/shared/typecheck.ts`; `js-to-ts` uses them; verify
      the js-to-ts tests pass unchanged

## 3. Metrics

- [x] 3.1 `measure()`: code lines and complexity from the normalised syntax tree, and the acceptance rule with its
      message; verify tests that reformatting and comments do not change the measures, each branch kind counts,
      nesting counts, and for "Smaller and simpler", "Longer" and "Nothing to simplify"

## 4. The step

- [x] 4.1 Instructions and per-file prompt; verify a test that the system prompt states every direction and
      prohibition in specs/simplify-step "Simplification rules"
- [x] 4.2 `simplify` step: size filter, tools, post-conditions (exports, metrics, type errors), `allowedChanges`,
      `preflight`; register it; verify end-to-end runs with a scripted model for "Small file", "Large file", "Test
      edited", "Export removed", "Longer" with a retry, and "Nothing to simplify"

## 5. Docs and checks

- [x] 5.1 Update README (what simplify does and will not do, cost control), docs/design.md status and DECISIONS.md;
      verify the README config passes `check-config`
- [x] 5.2 Run `npm run verify`; verify it passes
