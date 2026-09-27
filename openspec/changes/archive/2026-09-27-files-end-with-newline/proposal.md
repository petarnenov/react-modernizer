# Proposal

## Why

In the geowealth pilot, 3 of the 4 files the agent wrote had no newline at the end: `QueryProvider.tsx` and both
characterization tests. Git shows every such file with `\ No newline at end of file`, and most editors and linters
flag it. The user wants every file the agent writes to end with one empty line.

## What Changes

- Every file a step's model writes through its write tool (`write_file`, `write_test_file`, in every step) is saved
  ending with exactly one newline. A missing final newline is added, and trailing blank or whitespace-only lines are
  reduced to that one newline.
- The content before the end is saved as the model wrote it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution`: a new requirement that files written by a step's model end with exactly one newline.

## Impact

- `src/steps/shared/tools.ts` (`writeOneFileTool`), used by all four writing steps. No step code changes.
- A test for the tool, and one step-level check.
- No config option. Files the model does not write (renamed but untouched ones) keep their bytes.
