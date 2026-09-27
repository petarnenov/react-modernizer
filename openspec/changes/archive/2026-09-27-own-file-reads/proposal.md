# Proposal

## Why

In the pilot, `analyze` on one helper read two of its importers (`Currency.tsx`, `Number.tsx`) because its prompt
invites that. Each read costs a turn and the file's size in tokens. `analyze` and `simplify` judge or rewrite only
the file itself, so they do not need anything beyond the file and its tests.

## What Changes

- In `analyze` and `simplify`, `read_file` reads only the file being processed and its tests: the characterization
  test and the colocated `<name>.test.*`. Any other path is refused with a tool error that names the readable paths.
- `list_directory` is no longer offered to `analyze` and `simplify`.
- `analyze`'s prompt no longer names the importers or invites reading them.
- `simplify`'s prompt names the file's tests that exist, since the model can no longer find them by listing.
- `characterize-tests`, `class-to-function` and `js-to-ts` are unchanged. They keep full `read_file` and
  `list_directory`, confined to the target as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `analyze-step`: the model reads only the file and its tests, cannot list directories, and is not pointed at
  importers.
- `simplify-step`: the model reads only the file and its tests, cannot list directories, and is told which tests
  exist.

## Impact

- `src/steps/shared/tools.ts`: a read tool limited to a fixed set of paths.
- `src/steps/analyze/step.ts`, `src/steps/analyze/instructions.ts`
- `src/steps/simplify/step.ts`, `src/steps/simplify/instructions.ts`
- `test/analyze.test.ts`, `test/simplify.test.ts`, and a test for the new tool
- No config, dependency or CLI change.
