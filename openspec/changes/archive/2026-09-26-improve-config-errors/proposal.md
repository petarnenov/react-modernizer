# Proposal

## Why

A user upgraded, kept an old `modernizer.config.yaml` with `steps.js-to-ts.codemod`, and got
`Unrecognized key: "codemod"` — twice, after editing a different file. The error named the key but not the file it
came from, and did not say that the option had been removed on purpose or what to do. The project context also still
described `ts-migrate` and the Claude Agent SDK as planned, which is no longer true.

## What Changes

- Every configuration error names the file it came from.
- Options that existed and were removed get a hint saying so and what to do instead; the first is
  `steps.js-to-ts.codemod` ("removed: ts-migrate is no longer used; delete this line").
- `openspec/project.md` and the context in `openspec/config.yaml` describe the tools actually used: the Anthropic SDK
  tool runner for model calls and the TypeScript compiler API for parsing and checks; no codemods.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration`: "Validated configuration file" — errors name the file; removed options carry a hint.

## Impact

- `src/config/load.ts` (message and removed-option hints), tests.
- `openspec/project.md`, `openspec/config.yaml` (context only).
