# react-modernizer

Agent orchestrator that walks a React codebase file by file and, for each file, reports bugs, pins its behaviour with
characterization tests, migrates class components to function components and JavaScript to TypeScript, and
simplifies it — accepting each step only when lint, the type checker and the tests pass. Built for large
(thousands of files) CRA + Redux + React Router + React Query + Zustand + Jest codebases; configurable for others.

## Tech stack

- Node.js ≥ 22.13, TypeScript (strict), ESM. Exact versions pinned in package.json and explained in DECISIONS.md.
- zod for configuration; yaml for the config file; commander for the CLI.
- Vitest for this repository's tests. The target codebase keeps its own test runner (Jest).
- Model calls through the Anthropic SDK (`@anthropic-ai/sdk`) tool runner, behind a `ModelClient` interface, with
  tools we define. Parsing, detection, renames and every check use the TypeScript compiler API. No codemods.

## Layout

```
src/
  cli.ts                  command-line entry
  config/                 schema (zod) and loading
  orchestrator/           scheduler and worker pool
test/                     Vitest tests, one file per module
docs/design.md            architecture and plan
openspec/                 specs and changes
```

## Conventions

- The orchestration loop is deterministic code. The model is called only inside a step, for one file, with a narrow
  context.
- Steps report bugs; they never fix them.
- Concurrency is a setting, not a mode: one code path for one or many workers. The default is one worker.
- Every configuration option is defined and validated in one schema; nothing reads configuration around it.
- Gates judge the diff as well as exit codes: no `any`, `@ts-ignore`, `eslint-disable` or snapshot tests introduced,
  and tests pinned by characterize-tests are never weakened.
- No `any`, `@ts-ignore` or `eslint-disable` in this repository either.
- A dependency version change is recorded in DECISIONS.md in the same commit.
- Every behaviour change goes through an OpenSpec change under openspec/changes/ before code.
