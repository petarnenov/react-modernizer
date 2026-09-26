# Proposal

## Why

After `class-to-function`, a file is a function component still written in JavaScript. `js-to-ts` is where the
codebase gets its types — and where a model is most tempted to cut corners (`any`, `@ts-expect-error`, a runtime
check added to silence the compiler). The step must add types and nothing else: the program that runs has to be the
same program as before, only now typed.

## What Changes

- **`js-to-ts` step**: renames the file to `.ts` (or `.tsx` when it contains JSX) and its characterization tests
  with it, then a model adds types to both, following strict TypeScript practice.
- **Types only, proven.** After the model, the TypeScript is compiled back to JavaScript with types erased and
  compared with the original JavaScript, ignoring formatting and comments. Any difference — a changed expression, an
  added guard, an `enum` — fails the attempt with the differing lines. Behaviour cannot change because the code
  cannot.
- **Type errors are the model's to fix.** The model has a `check_types` tool that runs the configured type check and
  returns the errors for its files; the gates run the type check too.
- **Stricter forbidden patterns**: `@ts-expect-error` joins the defaults, next to `any`, `@ts-ignore` and
  `@ts-nocheck`.
- **Only runtime exports must stay the same.** Adding exported types (for example `CardProps`) is allowed; removing
  or renaming a value export is not.
- **Imports that would break are caught before any model call.** When another file imports this one with an explicit
  extension (`'./Card.jsx'`), renaming would break it; the file fails with the importers named. The run gives steps
  the file's importers from the import graph.
- **The project must be ready for TypeScript.** The run refuses to start with `js-to-ts` enabled when the target has
  no `tsconfig.json` — Phase 0 in the design.
- **No `ts-migrate`.** The planned codemod option is removed: ts-migrate works by inserting `any` and
  `@ts-expect-error`, exactly what this step must not produce.

## Capabilities

### New Capabilities

- `js-to-ts-step`: what it renames, what counts as done (types only, no type errors, same runtime exports), what it may
  touch, and the typing rules.

### Modified Capabilities

- `configuration`: `js-to-ts` options (`typecheckCommand`, `testCommand`, `helpers`), `codemod` removed,
  `@ts-expect-error` forbidden by default.

## Impact

- New `src/steps/js-to-ts/` (types-only comparison, instructions, step); `analysis.ts` gains value/type export
  separation; `StepContext` gains `importers`, filled by the runner from the graph.
- `src/config/schema.ts`, `modernizer.config.example.yaml`, `src/run/runner.ts`, `src/steps/registry.ts`,
  `docs/design.md` (codemod principle).
- No new dependency: the comparison uses the TypeScript compiler already in use.
- **Breaking config:** `steps.js-to-ts.codemod` is no longer accepted.
