## ADDED Requirements

### Requirement: Tests the step runs

The step's `run_tests` tool SHALL run the configured `testCommand` with `{testFile}` replaced by the file's
characterization test after renaming and `{file}` by the renamed file. When the file has no characterization test and
the command refers to `{testFile}`, the tool SHALL run nothing and tell the model there is no test to run.

#### Scenario: Own test only

- **WHEN** `src/Card.jsx` became `src/Card.tsx` and its test `src/Card.characterization.test.tsx`
- **THEN** `run_tests` runs `{testRunner} src/Card.characterization.test.tsx` and no test of any importer

#### Scenario: No test

- **WHEN** `src/format.js` has no characterization test
- **THEN** `run_tests` runs nothing and says there is no test for this file
