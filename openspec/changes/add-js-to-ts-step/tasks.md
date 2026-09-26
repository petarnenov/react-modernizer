# Tasks

## 1. Configuration

- [x] 1.1 Replace `codemod` with `typecheckCommand`, `testCommand` and `helpers` on `steps.js-to-ts`; add
      `@ts-expect-error` to the forbidden defaults; refuse `js-to-ts` without `tsconfig.json`; update the example
      config and design principle 5; verify tests for "Defaults", "Old codemod option" and "No tsconfig"

## 2. Analysis

- [x] 2.1 `exportedNames` reports value or type per name; verify tests for interfaces, type aliases, `export type`
      and "Exported props type"; class-to-function tests still pass
- [x] 2.2 Types-only comparison: erase with `transpileModule` (`verbatimModuleSyntax`, JSX preserved), normalise both
      sides with one printer, report the first differing lines; verify tests for "Only annotations added", "Guard added
      to satisfy the compiler", "Enum", generics, `as`, `import type`, and an unused `React` import kept

## 3. Importers

- [x] 3.1 `StepContext.importers` from the graph's reverse imports, filled by the runner; verify a runner test that a
      step sees the importers of its file with their specifiers

## 4. The step

- [x] 4.1 Instructions and per-file prompt; verify a test that the system prompt states every rule in
      specs/js-to-ts-step "Typing rules"
- [x] 4.2 `js-to-ts` step: skip TypeScript files, importer check, rename source and test file, tools (`write_file`,
      `write_test_file`, `check_types` filtered to the two files, `run_tests`, reads, `report_bug`), post-conditions
      (types only, value exports, no type errors); register it; verify end-to-end runs with a scripted model for
      "Component", "Plain module", "Explicit extension", "Remaining type error", and a retry after a types-only failure

## 5. Docs and checks

- [x] 5.1 Update README (enabling, Phase 0 prerequisite, what it will not do), docs/design.md status and DECISIONS.md
      (no ts-migrate, types-only proof); verify the README config passes `check-config`
- [x] 5.2 Run `npm run verify`; verify it passes
