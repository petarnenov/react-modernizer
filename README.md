# react-modernizer

A configurable agent orchestrator that walks a React codebase file by file and, for each file:

1. finds bugs (and reports them — it does not fix them),
2. pins current behaviour with unit tests,
3. migrates class components to function components,
4. migrates JavaScript to TypeScript, tests included,
5. simplifies the code,

accepting each step only when lint, `tsc` and the tests pass. Then it moves on to the next file.

Built for large **CRA + Redux + React Router + React Query + Zustand + Jest** codebases. See
[docs/design.md](docs/design.md) for how it works and what is still planned.

> **Status:** early. Configuration, the import graph, `plan`, the run loop (worktrees, gates, commits, resume) and the
> five steps — `analyze`, `characterize-tests`, `class-to-function`, `js-to-ts`, `simplify` — work. Not yet tried on a
> real codebase with a real model: run a pilot first (below).

## Usage

```sh
npm install
npm run build
cp modernizer.config.example.yaml modernizer.config.yaml   # set `target`
node dist/bin.js check-config                              # validate, print with defaults
node dist/bin.js check-config --workers 4                  # override concurrency
node dist/bin.js plan                                      # order + graph problems, changes nothing
node dist/bin.js plan --json > plan.json                   # the same, machine-readable
node dist/bin.js run                                       # process files; commits go to branch modernizer/run
node dist/bin.js run --workers 4 --fresh                   # more agents; ignore saved progress
node dist/bin.js status                                    # done / failed / pending, and why files failed
```

One agent runs at a time by default (`concurrency.workers: 1`).

Run `plan` first on a new codebase: it lists the order files would be processed in, every import that cannot be
resolved, dynamic imports that cannot be followed, files that do not parse, and import cycles — in seconds, with no
model calls.

## Finding bugs first (`analyze`)

The first step reads each file before anything changes and reports bugs and risks — it cannot change a line. Your
linter's output for the file (`steps.analyze.lintCommand`, ESLint by default) is given to the model as evidence.
Findings have a line, a severity and a reason, and `status` lists them highest first:

```
[high] src/Cart.jsx:31  total ignores discounts  (analyze)
[low] src/List.jsx:12  index used as key  (analyze)
```

Every step can report findings; none fixes them — the modernisation keeps behaviour, bugs included. To save cost,
raise `steps.analyze.minLines` or give analysis a cheaper model (`steps.analyze.model: claude-haiku-4-5`).

A step that changes nothing is not re-checked by the gates, so problems a file already has (legacy lint errors) do not
fail steps that did not touch it.

## Running `characterize-tests`

The first step with a model: for each file it writes React Testing Library tests of what the file does **today** into
`<Name>.characterization.test.<ext>`, runs them until they pass, and reports suspected bugs instead of fixing them. Its
model can read the project, write only that one test file, and run only the test command.

1. **Credentials:** set `ANTHROPIC_API_KEY`, or run `ant auth login`. The run checks them before the first file.
2. **Model and cost:** `claude-sonnet-5` at effort `high` by default (`model.default`, `model.effort`; a step can
   set its own `model`). Every file costs model calls; `budget.maxTokensPerFile` stops a runaway file, and `status`
   shows the tokens used so far.
3. **Pilot on a few files first:** narrow `source.include` and enable only this step:

   ```yaml
   target: ../my-cra-app
   source:
     include: ['src/components/Button*.jsx', 'src/utils/format*.js']
   steps:
     analyze: { enabled: false }
     class-to-function: { enabled: false }
     js-to-ts: { enabled: false }
     simplify: { enabled: false }
     characterize-tests:
       helpers: [src/test-utils.js] # your renderWithProviders, if you have one
   ```

   ```sh
   node dist/bin.js plan     # check what will be processed
   node dist/bin.js run      # tests land on branch modernizer/run
   node dist/bin.js status   # tokens used, reported bugs, failures and why
   git log -p main..modernizer/run
   ```

   Review the tests by hand before widening `source.include`.

## Converting class components (`class-to-function`)

Runs after `characterize-tests`, in the same run. For each file with class components, a model rewrites them as
function components with hooks — in place, still JavaScript. It can write only that file; the characterization tests
and every related test must pass **unchanged**.

- Files without class components, and error boundaries (`skip: [error-boundary]`), pass with **no model call**.
- After the model, the file is parsed again: no class component may remain and its exports must be the same, or the
  attempt fails with the reason.
- It will not run without `characterize-tests` enabled, unless you set `steps.class-to-function.requireTests: false`.
- It does not touch `connect()` or other wrappers, other files, or types.

```yaml
steps:
  analyze: { enabled: false }
  js-to-ts: { enabled: false }
  simplify: { enabled: false }
  # characterize-tests and class-to-function are on by default
```

## Moving to TypeScript (`js-to-ts`)

Runs after `class-to-function`. It renames the file (`.tsx` with JSX, `.ts` without) and its characterization tests,
then a model adds types. It needs a `tsconfig.json` in the target (Phase 0 in docs/design.md): without one, the run
will not start.

- **Types only, proven:** the result is compiled back to JavaScript with types erased and compared with the original.
  Any change to the code — a guard added for the compiler, an `enum` — fails the attempt, with the lines shown.
- **Strict:** no `any`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`; type errors in the file fail the attempt.
- **Nothing breaks:** runtime exports stay the same (new exported types are fine); a file that another file imports
  with an explicit `.js`/`.jsx` extension fails before any model call, naming the importer.
- Give it your shared types: `steps.js-to-ts.helpers: [src/store/hooks.ts, src/api/types.ts]`.

## Simplifying (`simplify`)

The last step: a model makes the file smaller and clearer with identical behaviour.

- **Measured, not claimed:** code lines and complexity (branches plus nesting), from the syntax tree with comments and
  formatting ignored. A change is kept only if neither grows and one shrinks. Leaving the file unchanged is fine.
- **Same surface:** every export, value and type, keeps its name; tests are read-only.
- **Cost control:** files under `steps.simplify.minLines` (40 code lines) are skipped without a model call.
- It will not remove `useMemo`/`useCallback`/`memo`, add dependencies, or change state management; bugs are reported.

## Tests, coverage and protection

- **One test runner.** `testRunner` (default `CI=true npx react-scripts test --watchAll=false`) is how every command
  runs your tests — the test gate, `characterize-tests`, and the coverage gate refer to it as `{testRunner}`. Create
  React App only runs Jest through `react-scripts`; a project that runs Jest directly sets `testRunner: npx jest --ci`.
- **Coverage gate.** Once a file has characterization tests, their line coverage of the file must reach
  `gates.coverage.min` (80%; `0` turns it off). A failure names the uncovered lines, and the step retries with them.
- **Test protection.** After `characterize-tests` (`gates.protectTestsFrom`) passes for a file, later steps may
  rename and type its tests, but may not delete them, lose test cases or `expect` assertions, or add `.skip`, `.only`,
  `xit`, `it.todo` and the like.

## How a run treats your repository

- Your checkout, index and current branch are never touched. Every accepted file is one commit on `modernizer/run`
  (configurable), created from `HEAD`.
- Workers use git worktrees kept inside `.git/modernizer/`, with your `node_modules` linked in, so the gates run
  your own eslint, tsc and jest.
- Stop it at any time; running again continues where it left off.
- Needs git 2.38 or newer.

## Development

Node ≥ 22.13.

```sh
npm run verify   # typecheck, lint, test, build
```
