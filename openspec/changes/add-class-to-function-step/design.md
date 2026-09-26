# Design

## Context

See proposal.md for why. What exists: `characterize-tests` (model step with confined tools, in
`src/steps/characterize-tests/`), the `ModelClient` with rate limit and budget, `allowedChanges` enforcement, test
protection and the coverage gate in the transaction, `{testRunner}`. The config already has
`steps.class-to-function.skip` (default `[error-boundary]`). The TypeScript parser reads JSX in `.js` files.

## Goals / Non-Goals

**Goals:**

- Behaviour identical by construction of the check: tests the step cannot edit must pass.
- No model spend on files that need no conversion.
- Deterministic post-conditions (no class left, same exports) checked by code, not by the model's word.

**Non-Goals:**

- `connect()` → hooks (its own, disabled step); TypeScript (`js-to-ts`); simplification (`simplify`).
- Updating other files. If a parent relies on a class-only API that cannot be kept, the file fails and is reported;
  cross-file refactors are out of scope.

## Decisions

### 1. Detection from the syntax tree

`findClassComponents(fileName, text)` walks the AST for class declarations and class expressions whose `extends` is
`Component`, `PureComponent`, `React.Component` or `React.PureComponent` (any import alias resolved by name only).
Each gets a kind: `error-boundary` when it has a `componentDidCatch` method or a static `getDerivedStateFromError`,
else `component`. Classes whose kind is in `skip` are excluded. No remaining class → the step returns without a model
call.

- _Alternative rejected — ask the model whether to convert:_ costs a call per file for a question the parser answers.

### 2. Exports check

`exportedNames(fileName, text)`: names from `export default` (as `default`), `export function/const/class`,
`export { a as b }`, `export * from` (recorded as `* from 'x'`). Compared as sets before and after. `module.exports`
is out of scope for a React codebase using ES modules; a CommonJS file is converted only if it has class components,
and its assignments are compared as text keys of `module.exports.x` / `exports.x`.

### 3. Post-conditions inside the step

The step runs the model, then parses the file: classes to convert remaining, or exports changed, throw an error
whose message becomes the retry's `previousFailure`. They run before the gates (cheap and specific), through the
existing "step threw" path, so no new transaction machinery is needed.

### 4. Tools shared with characterize-tests

`src/steps/shared/tools.ts` gets `confine`, `read_file`, `list_directory`, `run_tests(command)`, `report_bug`.
`characterize-tests` keeps its `write_test_file`; `class-to-function` gets `write_file` (content only; writes the
processed file). Behaviour of `characterize-tests` is unchanged — its tests must pass untouched.

### 5. Tests the model runs

`testCommand` defaults to `{testRunner} --findRelatedTests {file}`, which runs the characterization tests and any
existing test importing the file. `allowedChanges` is `[file]`, so a test edit is put back and fails the attempt
before the gates run — the tests the gates run are exactly the ones that existed before the step.

### 6. Instructions

A fixed, cacheable system prompt: the goal (identical behaviour, verified by tests you cannot change), the mapping
rules from the spec (lifecycle → effects with dependencies and cleanup, `setState` merge and functional updates,
instance fields → `useRef`, `shouldComponentUpdate`/`PureComponent` → `React.memo` with the comparator inverted,
`getDerivedStateFromProps` → derive during render, refs to instances → `forwardRef` + `useImperativeHandle`, `static`
members → properties on the function, HOC wrappers untouched, JavaScript stays JavaScript), and the working method
(read, rewrite with `write_file`, `run_tests` until PASSED). The per-file prompt names the file, the classes to
convert, the skipped ones, and the previous failure.

### 7. Refusing to convert without tests

In `resolveSteps`: `class-to-function` enabled with `requireTests` true and `characterize-tests` disabled → a
configuration error before anything runs. A file whose characterization failed never reaches this step (the file
fails as a whole), so every converted file had passing, covering, protected tests.

## Risks / Trade-offs

- [Behaviour the tests do not observe changes — e.g. an effect's timing] → Coverage ≥ 80% narrows this; the pilot
  reviews conversions by hand; bugs are reported, not silently fixed.
- [A parent uses `ref.current.someMethod()` on the class] → Instructions require `forwardRef` +
  `useImperativeHandle`; the parent's own tests (if any) run through `--findRelatedTests` only for the file itself,
  so a broken parent is caught when the parent is processed or by the project's test gate.
- [Detection by name misses `class X extends Base` where `Base extends Component`] → Such files are left as they are;
  `plan` output later can list them. Recorded as a known gap.
- [Large files with several classes exceed the token budget] → The budget stops the file; it is reported and can be
  retried with a larger `budget.maxTokensPerFile`.

## Open Questions

None that change the approach.
