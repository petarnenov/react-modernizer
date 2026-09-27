# Proposal

## Why

The single-file pilot (`pilot-one-all.yaml`, `sanitizerFunctions.js`, `glm-5.3`) failed on 2026-09-27 after 12 min and
1.52M tokens, over its 1.5M budget, without the model ever getting a fair chance:

- **The test gate could not pass.** `--findRelatedTests` pulls in `ProposalFeeRatesFields.test.tsx`, which fails 4 of
  its 20 tests on the untouched base. Lint and type errors are judged against a baseline (`newErrorsOnly`); test
  failures are not, so every `js-to-ts` attempt was blamed for a failure it did not cause and cannot fix. A step may
  not change that file anyway, and steps do not fix bugs.
- **The model read the same files again and again.** Compaction turns reads of files that are not the step's own into
  notes after two turns, so the model re-read `Percent.tsx`, `Number.tsx`, `ProposalFeeRatesFields.tsx` and the old
  test up to eight times each, resending them every time.
- **Hopeless attempts still ran.** Attempts 3 and 4 wrote nothing. The gates ran again on the same tree (1 min 24 s)
  and a further attempt started, until the budget ran out.
- **The log hid the failure.** A retry prints the first line of its reason, which for a gate is just
  `<command> failed:`.

## What Changes

- **Test gates judge new failures only.** `newErrorsOnly` gains the format `jest`: failing tests are parsed from
  Jest's default output (suite file and test title) and compared with the baseline like lint and type errors. A test
  that already failed before the step no longer fails its gate; a newly failing one does, and the model sees only it,
  with Jest's message.
- **The default test gate uses it:** `{ run: '{testRunner} --findRelatedTests {files}', newErrorsOnly: jest }`.
- **The latest read of every file stays.** Ollama compaction keeps the most recent `read_file` result of every path in
  full, not only the step's own files; earlier reads of the same path become notes. A read whose content is identical
  to that path's latest read comes back as a short note pointing to it instead of the content again.
- **An attempt that changes nothing since the gates rejected it ends the step.** When the working copy after an attempt
  is exactly what the gates last rejected, the gates are not run again, no further attempt starts, and the file fails
  with that gate failure and a note that the attempt changed nothing.
- **Retry progress shows the failure's first detail line**, e.g. `… failed: 1 new error(s): …`, instead of stopping at
  `failed:`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `quality-gates`: `newErrorsOnly: jest` for test gates.
- `configuration`: the default test gate uses `newErrorsOnly: jest`.
- `model-access`: Ollama compaction keeps the latest read of every file; an unchanged re-read is a note.
- `run-execution`: an attempt that leaves the rejected tree unchanged ends the step; retry progress carries the first
  detail line of the reason.

## Impact

- `src/run/baseline.ts` (Jest parser, `ERROR_FORMATS`), `src/config/schema.ts` (default gate), `src/model/ollama.ts`
  (compaction and re-read note), `src/run/transaction.ts` (unchanged attempt), `src/run/progress.ts` (retry line).
- Per file, one more run of the test gate command on the untouched file for its baseline (as the lint gate already
  does). Tests, README, `modernizer.config.example.yaml`, docs/design.md. No dependency changes.
