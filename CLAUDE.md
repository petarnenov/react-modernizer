# react-modernizer

Agent orchestrator that modernizes React codebases file by file. Read openspec/project.md first — it holds the
stack, layout and conventions — then docs/design.md for the architecture and plan.

## OpenSpec workflow

This project is developed spec-first with OpenSpec. Current behaviour is in openspec/specs/; work in progress is in
openspec/changes/.

- Any change in behaviour starts as a change: `/opsx:propose` (or `/opsx:explore` to think it through first).
- Code is written only through `/opsx:apply` for an existing change, following its tasks.md.
- When the change is implemented and verified: `/opsx:archive`, which merges its delta specs into openspec/specs/.
- Pure refactors, tooling and docs may skip specs (`skip_specs: true` in the change's .openspec.yaml), but still go
  through a change.
- `npm run specs` must pass; it is part of `npm run verify` and CI.

## Non-negotiables while editing

- The orchestration loop is deterministic code. Model calls happen only inside a step, for one file.
- Steps report bugs; they never fix them. Behaviour changes only through a separate, explicit change.
- Concurrency is a setting, not a mode: one code path for 1 or N workers. Default workers is 1.
- Every config option is validated in `src/config/schema.ts`; no config read bypasses `parseConfig`.
- Strict TypeScript. No `any`, `@ts-ignore` or `eslint-disable` in this repo either.
- If a dependency version moves, note it in DECISIONS.md in the same commit.

## Commands

- `npm run verify` — typecheck, lint, test, specs, build (what CI runs)
- `npm test` · `npm run lint` · `npm run format` · `npm run specs`
- `node dist/bin.js check-config [file] [--workers n]`
