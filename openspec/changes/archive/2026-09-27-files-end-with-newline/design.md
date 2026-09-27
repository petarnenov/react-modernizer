# Design

## Context

All writing steps (characterize-tests, class-to-function, js-to-ts, simplify) write through `writeOneFileTool` in
`src/steps/shared/tools.ts`, which saves `content` as given.

## Goals / Non-Goals

**Goals:**

- One place that guarantees the ending, so no step can forget it.

**Non-Goals:**

- Reformatting anything else (indentation, line endings inside the file). The target's own Prettier or ESLint is the
  judge of style.

## Decisions

- **In `writeOneFileTool`:** `content.replace(/\s*$/, '') + '\n'`. Trimming all trailing whitespace also removes
  spaces at the end of the last code line. That is harmless, and it keeps the rule to one line of code.
  - _Alternative:_ post-process after each step in the transaction. Rejected: that would also touch files the model
    did not write, and it would spread the rule over the run code.
- **Checks that compare before and after are unaffected.** js-to-ts's erase comparison and simplify's `normalize`
  ignore formatting, and test protection counts the syntax tree.

## Risks / Trade-offs

- [A target that wants no final newline] → Unusual; Prettier's default and POSIX both want one. If it comes up, it
  becomes an option then.
