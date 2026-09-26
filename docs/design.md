# Design

react-modernizer walks a React codebase one file at a time and, for each file, finds bugs, pins its behaviour with
tests, migrates it to a function component and to TypeScript, and simplifies it — accepting each step only when lint,
the type checker and the tests pass. It is built for large codebases (thousands of files) of the shape
**CRA + Redux + React Router + React Query + Zustand + Jest**, and is configurable for others.

## Principles

1. **Tests before change.** Behaviour is pinned by characterization tests on the _original_ file. Every later step must
   keep those tests passing unchanged; that is how a refactor is told apart from a change in behaviour.
2. **Bugs are reported, never fixed.** A fix changes behaviour, which is exactly what the tests are there to catch. Bugs
   go into the report and are fixed separately, each with a failing test first.
3. **The loop is code; the judgement is the model.** The orchestrator is a deterministic program: graph, queue, state,
   gates, git. The model is called for one step on one file with a narrow context.
4. **Gates check the diff, not just the exit code.** A model that cannot make a check pass will sometimes weaken the
   check instead. See [Gates](#gates).
5. **Code where mechanical, model where judgement.** Detection, renames and every check are code (the TypeScript
   parser and compiler); the model does only what needs understanding. No codemod that inserts `any` or
   `@ts-expect-error` — `ts-migrate` was considered and rejected for that reason.
6. **One worker by default.** Concurrency is a setting, not a mode — the same code runs one worker or many.

## Pipeline per file

| #   | Step                     | Default | Output                                                     |
| --- | ------------------------ | ------- | ---------------------------------------------------------- |
| 1   | `analyze`                | on      | Bug report entries. No code change.                        |
| 2   | `characterize-tests`     | on      | React Testing Library tests of the original behaviour.     |
| 3   | `class-to-function`      | on      | Function component + hooks. Error boundaries are skipped.  |
| 4   | `redux-connect-to-hooks` | **off** | `connect()` → `useAppSelector` / `useAppDispatch`.         |
| 5   | `js-to-ts`               | on      | `.tsx`/`.ts` for the file and its tests, strict, no `any`. |
| 6   | `simplify`               | on      | Smaller, clearer code with identical behaviour.            |

After every step the file's gates run. On failure the model gets the gate output and retries, up to `retry.perStep`
times; then the file is reverted and reported (`revert-and-report`) or the run stops (`stop`).

### Class → function pitfalls the step must handle

- Error boundaries stay classes — React has no hook for `componentDidCatch`.
- `getDerivedStateFromProps`, `shouldComponentUpdate` (→ `React.memo`), `getSnapshotBeforeUpdate`.
- Refs to class instances used by parents, HOCs that rely on `this`, instance fields used as mutable state (→ `useRef`).
- `useEffect` is not a 1:1 mapping of lifecycle methods; the characterization tests are the check.

### What the model must not do

- Move state between Redux, React Query and Zustand. That is an architecture decision, not a refactor.
- Change public props or exports other than adding types.
- Touch files outside its assignment. Shared hot spots (barrel `index` files, shared types, `tsconfig`) are changed
  only by the orchestrator.

## Order: the dependency graph

Files are processed leaves first (utils → hooks → small components → pages), so a file is migrated after the files it
imports and can use their types instead of `any`. A failed dependency counts as settled — it stays JavaScript and its
dependents are still migrated. Import cycles are broken at the file with the fewest unsettled imports.

Implemented in `src/orchestrator/scheduler.ts`; the graph itself in `src/graph/` (discovery, import extraction with
the TypeScript parser, CRA-style resolution including `baseUrl`, cycles). `plan` shows the order and the graph's
problems — unresolved imports, unfollowable dynamic imports, parse errors, cycles — without calling a model.

## Gates

Per file, after every step:

- `gates.commands` — by default `eslint {files}`, `tsc --noEmit --incremental`, `jest --findRelatedTests {files}`. CRA's
  Jest compiles TypeScript with Babel, which does **not** type-check, so `tsc` is mandatory.
- `gates.coverage.min` — line coverage of the file by its tests.
- `gates.forbid` — patterns that may not appear in **added** lines: `any`, `@ts-ignore`, `eslint-disable`,
  `toMatchSnapshot` by default.
- `gates.protectTestsFrom` — tests written by that step may not be deleted, skipped or have assertions removed by later
  steps.

## Concurrency and isolation

- `concurrency.workers` (default **1**, `--workers` on the command line) — agents at once.
- Each worker runs in its own **git worktree**, also when there is only one: the main branch stays clean until a file
  passes, and a revert is deleting the worktree.
- `concurrency.gates` — how many gate runs at once (defaults to `workers`); eight parallel `tsc`/`jest` runs over a
  large codebase will saturate a machine before the model does.
- `concurrency.requestsPerMinute` — one shared ceiling on model calls.
- `budget.maxTokensPerFile`, `budget.maxTotalCostUsd` — the run stops cleanly when reached.

At 3–8 minutes per file, one worker needs roughly 400–1000 hours for 8000 files. The pilot measures the real figure.

## Review

Results are committed one file per commit and grouped into pull requests by directory (`batching.maxFiles`, default
40). Each PR lists bugs found, files skipped and why, and coverage before and after.

## Phase 0 — foundation in the target codebase

Done once, before the first file, by a person or under close supervision:

- `tsconfig.json` with `allowJs: true` and `strict: true` (CRA supports TypeScript without ejecting).
- Typed store: `RootState`, `AppDispatch`, `useAppSelector`, `useAppDispatch`.
- `renderWithProviders()` test helper: Redux store, `QueryClientProvider` with `retry: false`, `MemoryRouter`.
- Types for API hooks (React Query) and Zustand stores — nearly everything depends on them.

## Pilot

Before the whole codebase: 50–100 files across kinds (plain, class, `connect`-ed, React Query). Measure pass rate
without human help, time and tokens per file, and review a sample of the tests by hand. Tune prompts and gates, then
scale `workers`.

## Run, state and resume

Each worker has a git worktree of the target; accepted files are committed one per commit on the run branch
(`git.branch`, default `modernizer/run`), merged with `git merge-tree` so parallel workers never need a checkout.
Worktrees and `state.json` live in `<git-dir>/modernizer/runs/<branch>/` — never in the user's working tree. Running
again resumes; `--fresh` starts over. Requires git ≥ 2.38.

## Status

Behaviour that exists is specified in `openspec/specs/`; planned parts become OpenSpec changes.

| Part                                          | State   |
| --------------------------------------------- | ------- |
| Config schema, loading, `--workers` override  | done    |
| Dependency-ordered scheduler, worker pool     | done    |
| Import graph, `plan` command                  | done    |
| Worktrees, run branch, commits, state, resume | done    |
| Model access: credentials, rate, token budget | done    |
| Step: characterize-tests                      | done    |
| Step: class-to-function                       | done    |
| Step: js-to-ts                                | done    |
| Steps: analyze, simplify                      | planned |
| Gates: commands, timeout, forbidden patterns  | done    |
| Gates: coverage, test protection              | done    |
| Reports and PR batching                       | planned |
