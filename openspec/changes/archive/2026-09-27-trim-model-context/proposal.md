# Proposal

## Why

The full-pipeline pilot with `glm-5.3` ran out of its 500k-token budget in the first `js-to-ts` attempt, after 31
requests of about 15k input tokens each. The model behaved well: it read the importers it had to fit and reported
good findings. The waste came from what the tool sends and runs:

- **Re-reads.** History compaction replaces the step's own file and test with a note after two turns, so the model
  read `sanitizerFunctions.js` and its test three times each in `analyze` alone.
- **Old reasoning resent.** Every earlier assistant message goes back with its `thinking`, which is long for GLM and
  gpt-oss, on every turn.
- **Slow, redundant tests.** `js-to-ts` runs `--findRelatedTests` on a widely imported file, 1 min 24 s per call. The
  step proves that the erased JavaScript is identical to the original and may change only its two files. So only its
  own (typed) test file can behave differently. The final gate still runs the related tests once.

## What Changes

- **Own files stay.** The latest result of reading each of the step's own files (the file being processed and its
  test) is always sent in full. Older reads of the same path are superseded and become notes.
- **Old thinking dropped.** Assistant messages older than the last two turns are sent without their `thinking`.
  Their text and tool calls stay.
- **`js-to-ts` tests its own test file.** The default `testCommand` becomes `{testRunner} {testFile}`, where
  `{testFile}` is the file's characterization test after renaming. When the file has no such test, `run_tests` says
  so instead of running anything.
- The `configuration` spec also gets the type-check default that `add-gate-baselines` introduced but did not record:
  `npx tsc --noEmit --incremental --tsBuildInfoFile {cache}/tsc.tsbuildinfo`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-access`: Ollama compaction keeps the step's own files and drops old thinking.
- `configuration`: `js-to-ts` defaults (test command, and the recorded type-check command).
- `js-to-ts-step`: its test run covers its own test file.

## Impact

- `src/model/client.ts` (`ToolRunRequest.ownFiles`), `src/model/ollama.ts`, the five steps pass their own files,
  `src/config/schema.ts`, `src/steps/js-to-ts/step.ts`. Tests, README, DECISIONS.md.
