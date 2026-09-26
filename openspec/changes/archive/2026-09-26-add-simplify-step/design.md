# Design

## Context

See proposal.md for why. What exists: three model steps built the same way — confined shared tools, a one-file write
tool, `allowedChanges`, post-conditions thrown into the retry, a per-file baseline keyed by worktree and file,
`exports()` with value/type kinds, `errorsFor` for type-check output, the gates (commands, forbidden patterns,
coverage, test protection). `simplify` runs last, on the file's current path (usually `.tsx`/`.ts` by now).

## Goals / Non-Goals

**Goals:**

- Simplifications that are real — measured, not claimed.
- No behaviour change beyond what the tests and type checker can detect, and no public surface change at all.
- No model spend on files too small to be worth it.

**Non-Goals:**

- Cross-file refactors: extracting shared components, moving code between files, deduplicating across files.
- Performance work, memoisation changes, library upgrades.
- A proof of equivalence like `js-to-ts` has; here the code is meant to change, so the tests are the evidence.

## Decisions

### 1. Metrics from the syntax tree, formatting ignored

`measure(fileName, text)` parses the file, prints it with the shared printer without comments (the same
normalisation as `js-to-ts`), and counts:

- **code lines**: non-empty lines of the printed code;
- **complexity**: decision points (`if`, conditional expressions, `case`, `for`/`for…of`/`for…in`/`while`/`do`,
  `catch`, `&&`, `||`, `??`) plus the maximum nesting depth of functions and blocks.

Printing first means a reformatted file measures the same, so the model cannot "win" by reflowing lines, and cannot
lose by it either.

- _Alternative rejected — ESLint complexity rules:_ a second parser and configuration for two numbers the TypeScript
  AST already gives.

### 2. Acceptance rule

Unchanged (normalised text equal) → pass. Otherwise `after.lines ≤ before.lines`, `after.complexity ≤
before.complexity`, and at least one strictly smaller. Failure reads
`not simpler: 120 → 140 code lines, complexity 18 → 18`, and goes to the retry like any other.

### 3. Size filter

`minLines` compares against the same code-lines measure, so it is independent of formatting and comments. Default 40:
below that, the chance of a worthwhile simplification rarely pays for a model call.

### 4. Surface frozen

All exports, value and type, compared as a set (`exportsChanged` over `exportedNames`), stricter than `js-to-ts`,
because nothing here needs to add an export.

### 5. Tools and checks

Same shape as `js-to-ts` without the rename: reads, `write_file` for the file, `check_types` (filtered to the file with
`errorsFor`), `run_tests`, `report_bug`. After the model: exports, metrics, then type errors in the file. Tests are
read-only through `allowedChanges: [file]`.

`errorsFor` and the type-check helper move to `src/steps/shared/typecheck.ts`, used by both steps.

### 6. Instructions

A cacheable system prompt with the directions and prohibitions from the spec, the acceptance rule stated plainly
("leave the file unchanged if you cannot make it both not longer and not more complex"), and the working method.
The per-file prompt gives the file, its measures, and the previous failure.

## Risks / Trade-offs

- [A simplification changes behaviour on an uncovered line] → Coverage ≥ 80% narrows it; the step's rules forbid the
  riskiest moves (memoisation, state management); the pilot reviews a sample of simplifications by hand.
- [Metrics reward terseness over clarity, e.g. nested ternaries] → Conditional expressions count as branches, so
  collapsing `if` into `?:` gains nothing; nesting depth is part of complexity.
- [Removing an unused private helper that a test imported] → Tests import through exports, and exports are frozen.
- [Many files end up unchanged] → That is the intended cheap outcome; `status` shows the tokens spent.

## Open Questions

None that change the approach.
