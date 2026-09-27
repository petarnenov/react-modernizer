# Proposal

## Why

When a run refuses to start because of uncommitted changes, it lists the files relative to the repository root
(`WebContent/react/app/src/…`), while everything else the tool prints is relative to the target (`src/…`). On a
target inside a larger repository, such as geowealth, the paths do not match what the user sees in the plan and in
`status`.

## What Changes

- The refusal lists the changed files relative to the target, like the rest of the output.
- No spec change: the requirement says the files are named, not how their paths are written (`skip_specs: true`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- `openRunBranch` in `src/run/workspace.ts`, and a test in `test/workspace.test.ts`.
