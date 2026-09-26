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

> **Status:** early. Configuration, the import graph and the `plan` command work; `run` is not implemented yet.

## Usage

```sh
npm install
npm run build
cp modernizer.config.example.yaml modernizer.config.yaml   # set `target`
node dist/bin.js check-config                              # validate, print with defaults
node dist/bin.js check-config --workers 4                  # override concurrency
node dist/bin.js plan                                      # order + graph problems, changes nothing
node dist/bin.js plan --json > plan.json                   # the same, machine-readable
```

One agent runs at a time by default (`concurrency.workers: 1`).

Run `plan` first on a new codebase: it lists the order files would be processed in, every import that cannot be
resolved, dynamic imports that cannot be followed, files that do not parse, and import cycles — in seconds, with no
model calls.

## Development

Node ≥ 22.13.

```sh
npm run verify   # typecheck, lint, test, build
```
