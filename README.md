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
> first step, `characterize-tests`, work. The other steps are not implemented yet: disable them to run.

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
