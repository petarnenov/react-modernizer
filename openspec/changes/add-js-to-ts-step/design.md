# Design

## Context

See proposal.md for why. What exists: model steps with confined shared tools, `allowedChanges`, post-conditions that
throw into the retry, `producesTests` with name-based following of renamed test files, test protection (renames
allowed), the coverage gate following renamed files, `exportedNames`, the import graph with every import classified
and resolved. `gates.commands` already includes `npx tsc --noEmit --incremental`. The config still carries an
unimplemented `codemod: ts-migrate` option.

## Goals / Non-Goals

**Goals:**

- A typed file whose JavaScript is provably the one it replaced.
- Strict types without escape hatches, enforced by gates rather than hoped for.
- Nothing breaks elsewhere: runtime exports and imports stay valid.

**Non-Goals:**

- Typing files the step is not processing (they get their turn in dependency order).
- Changing `tsconfig.json`; making the project TypeScript-ready is Phase 0.
- `connect()` or Redux refactors; `simplify`.

## Decisions

### 1. The rename is done by code, before the model

The step renames `X.js(x)` → `X.ts(x)` itself (JSX detected from the syntax tree) and the characterization test file
the same way, then asks the model to type both. `allowedChanges` is the old and new paths of both files, so the
deletion of the old names and the new files are expected and nothing else is. The model gets `write_file` for the new
source path and `write_test_file` for the new test path.

### 2. Types-only by erasing and comparing

```
original JS ──parse──► print (no comments)  ─┐
new TS ──transpileModule(verbatimModuleSyntax, jsx: preserve, ESNext)──► parse ──► print ─┴─► equal?
```

`ts.transpileModule` erases types; `verbatimModuleSyntax` keeps every import that is not `import type` (without it,
TypeScript drops imports it considers unused, such as `React` under the new JSX transform, and the comparison would
fail for no reason). Both sides are printed by the same `ts.createPrinter({ removeComments: true })`, which normalises
formatting. A difference is reported as the first few differing lines of each side. The same check runs for the test
file: its types are allowed, its logic must stay — which also makes test protection hold trivially in this step.

- _Alternative rejected — trust the tests:_ they cover 80% of lines, not 100%, and cannot see a guard added on an
  uncovered branch. Erasure comparison covers every line.
- _Consequence accepted:_ a file that genuinely cannot be typed without changing code fails, with the reason. That
  is a finding for a person, not something a model should decide.

### 3. `check_types` tool and the gate

`typecheckCommand` runs in the worktree; the tool filters its output to lines mentioning the file or its test file,
so the model is not flooded with errors in other files. After the model, the step runs the same command and fails
the attempt when those files have errors. The general type-check gate still runs over the project.

### 4. Value exports vs type exports

`exportedNames` gains `kind: 'value' | 'type'` per name: interfaces, type aliases and `export type { … }` are types.
The step compares value exports only. `class-to-function` keeps comparing all names (it produces no types).

### 5. Importers from the graph

`StepContext` gains `importers: { file: string; specifier: string }[]`, filled by the runner from the graph's resolved
internal imports (a reverse map built once per run). The step fails early when a specifier ends in `.js` or `.jsx`.
Importers without an extension keep working: CRA and TypeScript resolve `.ts`/`.tsx`.

### 6. Readiness and forbidden patterns

`resolveSteps` refuses `js-to-ts` without `tsconfig.json` in the target. `@ts-expect-error` joins `gates.forbid`
defaults. `codemod` is removed from the schema; the example config and design principle 5 are updated.

### 7. Instructions

A cacheable system prompt: the goal (types only; the program must compile back to exactly the original JavaScript, and
that is checked); the typing rules from the spec; how to work (read the file, its imports and the helpers, write both
files, `check_types` and `run_tests` until clean). The per-file prompt names the old and new paths, the helpers, and
the previous failure.

## Risks / Trade-offs

- [Strict null checks that JavaScript code does not satisfy] → Precise types (`T | null`) and narrowing that already
  exists in the code are allowed; new runtime guards are not. Files that cannot be typed honestly fail and are listed.
- [`transpileModule` output differs in trivia from the original] → Both sides go through the same printer after
  parsing; a pilot will show residual differences, fixed in the normaliser, not by loosening the rule.
- [Project-wide `tsc` per file is slow] → `--incremental`; the tool filters output; the gate semaphore limits load.
- [Importers inside `node_modules` or outside the source selection] → Not in the graph; the project's test and type
  gates catch breakage there.

## Open Questions

None that change the approach.
