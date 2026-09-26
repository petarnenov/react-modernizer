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
> real codebase with a real model: run a [pilot](#pilot-step-by-step) first.

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
node dist/bin.js run --pick-model                          # choose the model from the provider's current list
node dist/bin.js run --model kimi-k2.6                     # or name it; the file is not changed
node dist/bin.js models                                    # list the provider's models now (--json)
node dist/bin.js status                                    # done / failed / pending, and why files failed
```

One agent runs at a time by default (`concurrency.workers: 1`).

Run `plan` first on a new codebase: it lists the order files would be processed in, every import that cannot be
resolved, dynamic imports that cannot be followed, files that do not parse, and import cycles — in seconds, with no
model calls.

## Pilot, step by step

Every step is tested, but with a scripted model and stand-in commands. Before a whole codebase, run a pilot on
10–15 files, in two phases: first one that changes no code (cheap, and shows whether the tests are good), then the
conversions. Run it on your own machine, where the codebase and its `node_modules` are.

### 0. Prerequisites

```sh
node --version   # ≥ 22.13
git --version    # ≥ 2.38
```

### 1. Install react-modernizer

```sh
git clone https://github.com/petarnenov/react-modernizer.git
cd react-modernizer
npm ci
npm run build
```

### 2. Prepare the target codebase

```sh
cd /path/to/your-app
git status                                        # clean: a run starts from the last commit, not uncommitted work
npm ci                                            # the gates use your eslint and jest from node_modules
CI=true npx react-scripts test --watchAll=false   # your tests must run at all
```

A run never touches your branch or working tree: accepted files go to a `modernizer/…` branch, and its working data
to `.git/modernizer/`.

### 3. Credentials

```sh
export ANTHROPIC_API_KEY=sk-ant-...   # or: ant auth login
```

Or `gpt-oss:120b` on Ollama Cloud — add `model: { provider: ollama }` to the config and:

```sh
export OLLAMA_API_KEY=...
```

It is weaker than Claude at tool use and exact code edits: the gates keep bad edits out, but expect more failed
attempts in the conversion steps. On the free tier, lower `concurrency.requestsPerMinute` if requests fail with 429.

### 4. Choose 10–15 files

```sh
cd /path/to/react-modernizer
cp modernizer.config.example.yaml pilot.yaml   # set `target` in it
node dist/bin.js plan pilot.yaml | less        # order, unresolved imports, cycles
```

Pick a mix: 3–4 class components, 3–4 function components, 2 utilities or hooks, 1–2 components using `connect()` or
React Query, and one large, tangled file.

### 5. Phase 1 — analysis and tests only (no source changes)

`pilot.yaml`:

```yaml
target: /path/to/your-app
source:
  include:
    - src/components/Button.jsx
    - src/components/UserCard.jsx
    - src/utils/format.js
    # … your 10–15 files
steps:
  analyze: {}
  characterize-tests:
    helpers: [] # e.g. [src/test-utils.js] if you have renderWithProviders
  class-to-function: { enabled: false }
  js-to-ts: { enabled: false }
  simplify: { enabled: false }
gates:
  commands:
    - npx eslint {files}
    - '{testRunner} --findRelatedTests {files}'
    # tsc left out: without a tsconfig.json it fails on every file
git:
  branch: modernizer/pilot-1
```

```sh
node dist/bin.js check-config pilot.yaml   # must say OK
node dist/bin.js run pilot.yaml
node dist/bin.js status pilot.yaml
```

While it runs, a live line per worker shows the file (`[2/7]`), the step and attempt, the model's current turn or
tool (`read_file src/api.js`), rate-limit waits and the gate being run, with the elapsed time. Finished steps, gates
and files stay above it. Piped to a file (`| tee run.log`), every event is a timestamped line instead. File contents,
prompts and model text are never printed.

Review, in the target:

```sh
git log --stat main..modernizer/pilot-1   # one commit per file
git show modernizer/pilot-1:src/components/Button.characterization.test.jsx
```

- **The tests:** do they check behaviour — what a user sees and does — without snapshots? Would they catch a real
  change?
- **The `analyze` findings:** real, or noise?
- **Failed files:** `status` shows why. Likely suspects: how `react-scripts test` takes the coverage flags, missing
  test helpers.
- **Tokens:** multiply by the model's price (Sonnet 5: $2 per million input, $10 per million output), divide by the
  number of files — that is the cost per file, and the forecast for the whole codebase.

### 6. Phase 2 — the full migration

When the phase 1 tests look right:

1. For `js-to-ts`, add a `tsconfig.json` to the target (Phase 0 in [docs/design.md](docs/design.md): `allowJs`,
   `strict`), commit it, and put `npx tsc --noEmit --incremental` back into `gates.commands`. Without it, keep
   `js-to-ts: { enabled: false }`.
2. In `pilot.yaml`, enable the steps and use a new branch:

   ```yaml
   steps:
     class-to-function: {}
     js-to-ts: {} # only with a tsconfig.json
     simplify: {}
   git:
     branch: modernizer/pilot-2
   ```

3. Run and review:

   ```sh
   node dist/bin.js run pilot.yaml
   node dist/bin.js status pilot.yaml
   git log -p main..modernizer/pilot-2
   ```

A new branch because a run resumes from its saved state: on the phase 1 branch, those files already count as done
and would not go through the new steps.

Review the converted components (effects, `setState`), the types (any vague types), and whether `simplify` really
simplified without changing meaning.

### 7. When something goes wrong

- **Interrupted** (Ctrl-C): run it again; it continues where it stopped.
- **Start over:** `node dist/bin.js run pilot.yaml --fresh`.
- **Clean up**, in the target:

  ```sh
  git branch -D modernizer/pilot-1 modernizer/pilot-2
  rm -rf .git/modernizer
  ```

### 8. What to report back

- `status` output for both phases;
- two or three commits that look right and two or three that do not (`git show <sha>`);
- the reasons files failed.

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
3. **Pilot first:** see [Pilot, step by step](#pilot-step-by-step).

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
- Workers use git worktrees in the system temp directory (`$TMPDIR/react-modernizer/…`), with your `node_modules`
  linked in, so the gates run your own eslint, tsc and jest. Not inside `.git`: Jest ignores every file there. Run
  state stays in `.git/modernizer/`.
- Stop it at any time; running again continues where it left off.
- Needs git 2.38 or newer.

## Development

Node ≥ 22.13.

```sh
npm run verify   # typecheck, lint, test, build
```
