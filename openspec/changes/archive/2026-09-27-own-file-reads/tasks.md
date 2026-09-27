# Tasks

## 1. Shared read tool

- [x] 1.1 Add `ownTestCandidates(file)` to `src/steps/characterize-tests/paths.ts` (characterization test plus `<name>.test.{js,jsx,ts,tsx}`); verify with a unit test for `src/Card.tsx` and `src/format.js`
- [x] 1.2 Add `readOwnFilesTool(cwd, paths)` to `src/steps/shared/tools.ts`, named `read_file`, going through `confine` and matching the normalised relative path; verify with tests: an allowed path returns content, `./`-prefixed allowed path returns content, another project file is refused naming the allowed paths, `../x` is still refused by `confine`

## 2. analyze

- [x] 2.1 In `src/steps/analyze/step.ts` replace `readTools` with `readOwnFilesTool(cwd, [file, ...ownTestCandidates(file)])` and name the existing tests in the prompt; update the tools test in `test/analyze.test.ts` to expect exactly `read_file` and `report_bug`
- [x] 2.2 Remove the importers line and `importers` from `src/steps/analyze/instructions.ts`; verify with a test that a file with importers gets a prompt naming none of them
- [x] 2.3 Verify with a test in `test/analyze.test.ts` that the model's `read_file` on another project file gets a tool error and the step still passes

## 3. simplify

- [x] 3.1 In `src/steps/simplify/step.ts` replace `readTools` with `readOwnFilesTool` over the file and its test candidates; verify in `test/simplify.test.ts` that the tools are `read_file`, `write_file`, `check_types`, `run_tests` and `report_bug`, and that reading another file is refused
- [x] 3.2 Add `tests` to the simplify `PromptInput` and name the existing tests (or `It has no tests.`); verify with tests for a file with a characterization test and a file without tests

## 4. Wrap-up

- [x] 4.1 Update docs/design.md if it describes what analyze or simplify can read; verify by grepping it for `read_file` and `importers`
- [x] 4.2 Run `npm run verify` and confirm it passes
