# react-modernizer

Agent orchestrator that modernizes React codebases file by file. Read docs/design.md first — it holds the pipeline,
the principles and what is planned.

Non-negotiables while editing:

- The orchestration loop is deterministic code. Model calls happen only inside a step, for one file.
- Steps report bugs; they never fix them. Behaviour changes only through a separate, explicit change.
- Concurrency is a setting, not a mode: one code path for 1 or N workers. Default workers is 1.
- Every config option is validated in `src/config/schema.ts`; no config read bypasses `parseConfig`.
- Strict TypeScript. No `any`, `@ts-ignore` or `eslint-disable` in this repo either.
- If a dependency version moves, note it in DECISIONS.md in the same commit.

Commands:

- `npm run verify` — typecheck, lint, test, build (what CI runs)
- `npm test` · `npm run lint` · `npm run format`
- `node dist/cli.js check-config [file] [--workers n]`
