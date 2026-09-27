## MODIFIED Requirements

### Requirement: New errors only

A gate with `newErrorsOnly: tsc`, `newErrorsOnly: eslint` or `newErrorsOnly: jest` SHALL parse the command's complete
output in that tool's format (`tsc`: `file(line,col): error TSnnnn: message`; `eslint`: the built-in `json` formatter,
counting severity 2 only; `jest`: Jest's default report, where each failing test is the `●` title under the `FAIL`
line of its test file, and a test file that could not run counts as one failure of that file), including when it is
longer than the output kept for display. Errors SHALL be compared as counts per file, code or rule, and message,
ignoring line and column; for `jest` the file is the test file and the message is the test's full title. An error is
new when the step's result has more of it than the baseline. For `jest`, the output given for a new failure SHALL
include the start of Jest's message for that test. A file renamed by a step SHALL be compared with the baseline of its
old name. The baseline of a command without `{files}` SHALL be taken once per run at the run's base commit and reused
on resume for the same base; the baseline of a command with `{files}` SHALL be taken on the file before its first
step, and a file created by a step SHALL have an empty baseline. The run SHALL report each baseline and its error
count.

#### Scenario: Legacy type errors

- **WHEN** the project has 2,996 type errors at the base and a step adds none
- **THEN** the `tsc` gate passes

#### Scenario: One new error

- **WHEN** a step's change adds one type error to `src/a.ts`
- **THEN** the gate fails and its output is that one error

#### Scenario: Code moved

- **WHEN** a step moves code so that an existing error is reported on another line of the same file
- **THEN** the error is not new

#### Scenario: Renamed file

- **WHEN** `js-to-ts` renames `src/a.js` to `src/a.ts` and `src/a.js` had two lint errors that `src/a.ts` still has
- **THEN** those two errors are not new

#### Scenario: Unparseable failure

- **WHEN** a baseline gate exits non-zero and reports no error in its format, for example because the tool crashed
- **THEN** the gate fails with the command's output

#### Scenario: Test failing before the step

- **WHEN** a related test `Fields.test.tsx › sets a negative default` fails on the untouched file and still fails after the step, and every other test passes
- **THEN** the `jest` gate passes

#### Scenario: Newly failing test

- **WHEN** after the step `Card.characterization.test.tsx › formats 1000` fails and it passed on the untouched file
- **THEN** the gate fails, and its output names that test with the start of Jest's message and does not list the tests that already failed

#### Scenario: Console output of a passing test

- **WHEN** a passing test file prints a `● Console` block
- **THEN** it is not counted as a failure
