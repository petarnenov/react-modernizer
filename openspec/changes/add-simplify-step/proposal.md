# Proposal

## Why

After `js-to-ts` a file is a typed function component — but it is still the old code, now in new syntax: derived
state kept in `useState` and synced by effects, conditions nested four deep, the same JSX written three times,
helpers that nothing calls. `simplify` is the last step, and the only one whose purpose is to change code rather than
keep it. That makes it the easiest step to get wrong in two ways: changing behaviour, and "simplifying" into something
longer or more tangled.

## What Changes

- **`simplify` step**: a model makes the file smaller and clearer with identical behaviour — no change to what it
  renders, does or exports.
- **Behaviour guarded by what exists**: the characterization tests and related tests are read-only and must pass,
  coverage and type checks apply, forbidden patterns apply.
- **Public surface frozen**: every export, value and type, keeps its name. Simplifying is internal.
- **Simpler, measured**: code size and complexity are measured with the TypeScript parser before and after, with
  comments and formatting ignored. A change is accepted only when neither gets worse and at least one improves.
  "Nothing worth simplifying" is a valid answer: an unchanged file passes.
- **No spend on small files**: files below `steps.simplify.minLines` (40 code lines by default) pass without a model
  call.
- **Conservative rules**: no removal of memoisation, no new dependencies, no change of libraries or state management,
  no renamed exports; bugs are reported, not fixed.

## Capabilities

### New Capabilities

- `simplify-step`: which files it touches, what counts as simpler, what it must keep, and the rules for simplifying.

### Modified Capabilities

- `configuration`: `simplify` options (`minLines`, `testCommand`, `typecheckCommand`).

## Impact

- New `src/steps/simplify/` (metrics, instructions, step); registered in `src/steps/registry.ts`.
- `src/config/schema.ts`, `modernizer.config.example.yaml`.
- No new dependency. Model calls only for files at or above `minLines`.
- With this change every step but `analyze` is implemented.
