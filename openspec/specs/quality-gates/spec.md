# quality-gates Specification

## Purpose

Decides whether a file's change is accepted: the project's own checks must pass on it, and the change must not
bring in the shortcuts a model takes when it cannot make a check pass.

## Requirements

### Requirement: Gate commands

After the steps have changed a file, each configured gate command SHALL run in that file's isolated working copy,
in order, with `{files}` replaced by the changed files, each quoted for the shell, and `{cache}` replaced by a
directory outside the working copy that belongs to the worker and is kept across runs of the same branch. A gate
command SHALL be either a command string, which passes when it exits zero, or `{ run, newErrorsOnly }`, which passes
when the command reports no error that is new compared with its baseline. When a command fails, the gates SHALL stop
at it and report its name and output; for a baseline gate, the output SHALL be the new errors only. With no changed
files, `{files}` SHALL be replaced by the file being processed.

#### Scenario: All commands pass

- **WHEN** every gate command exits zero
- **THEN** the gates pass

#### Scenario: A command fails

- **WHEN** the second of three commands exits non-zero
- **THEN** the gates fail, the third command does not run, and the failure names the second command and carries its output

#### Scenario: File names with spaces

- **WHEN** a changed file is `src/My Card.jsx`
- **THEN** the command receives it as one argument

#### Scenario: Cache outside the worktree

- **WHEN** a gate runs `npx tsc --noEmit --incremental --tsBuildInfoFile {cache}/tsc.tsbuildinfo`
- **THEN** the build info is written outside the worktree and is found again by the next file on the same worker

### Requirement: Gate timeout and concurrency

A gate command that runs longer than `gates.timeoutSeconds` SHALL be stopped and SHALL count as failed, with the
timeout named in its output. No more than `concurrency.gates` gate commands SHALL run at the same time across all
workers.

#### Scenario: Hanging command

- **WHEN** a gate command does not finish within the timeout
- **THEN** it is stopped and the gates fail with a message naming the timeout

#### Scenario: Limited concurrency

- **WHEN** four workers reach their gates at once and `concurrency.gates` is 2
- **THEN** at most two gate commands run at the same time

### Requirement: Forbidden patterns in added lines

The gates SHALL fail when a line the file's change adds contains any of the `gates.forbid` patterns, and SHALL name
the file, the pattern and the line. Lines that already contained a pattern before the change SHALL NOT fail the
gates.

#### Scenario: Introduced `any`

- **WHEN** the change adds the line `const x: any = 1;` and `: any` is forbidden
- **THEN** the gates fail naming the file, `: any` and that line

#### Scenario: Existing pattern

- **WHEN** a line containing `eslint-disable` existed before the change and is left as it was
- **THEN** it does not fail the gates

### Requirement: Coverage gate

After a step, when the processed file has tests written by a step that produces tests, the file's line coverage by
those tests SHALL be measured with the configured test runner. The gates SHALL fail when it is below
`gates.coverage.min`, and the failure SHALL state the measured percentage, the minimum, and the uncovered line numbers
of the file. When the file has no such tests yet, or the minimum is 0, no coverage SHALL be measured. Coverage output
SHALL be written outside the worktree, so it is never part of the file's change.

#### Scenario: Enough coverage

- **WHEN** the characterization tests cover 92% of `src/Card.jsx`'s lines and the minimum is 80
- **THEN** the coverage gate passes

#### Scenario: Too little coverage

- **WHEN** they cover 55% and lines 12–18 and 30 are never run
- **THEN** the gates fail with a message stating 55%, the minimum 80%, and lines 12–18 and 30, and the step's retry receives it

#### Scenario: Renamed file

- **WHEN** an earlier step renamed `src/Card.jsx` to `src/Card.tsx`
- **THEN** coverage is measured for `src/Card.tsx`

### Requirement: Test protection

Once the step named in `gates.protectTestsFrom` has passed for a file, the tests it wrote SHALL be protected for the
rest of that file's pipeline. A later step SHALL fail its attempt when it deletes a protected test file, reduces the
number of test cases or `expect` assertions in it, or introduces `.skip`, `.only`, `xit`, `xtest`, `xdescribe`,
`it.todo` or `test.todo` in it. Renaming a protected test file, for example to `.tsx`, and editing it otherwise SHALL be
allowed. With `gates.protectTestsFrom` set to null, no tests SHALL be protected.

#### Scenario: Deleted assertion

- **WHEN** `js-to-ts` removes one of twelve `expect` calls from `Card.characterization.test.jsx`
- **THEN** the attempt fails, naming the test file and the drop from twelve to eleven assertions

#### Scenario: Skipped test

- **WHEN** `simplify` changes `it('opens', …)` to `it.skip('opens', …)`
- **THEN** the attempt fails, naming the skipped test

#### Scenario: Converted to TypeScript

- **WHEN** `js-to-ts` renames the test file to `Card.characterization.test.tsx`, adds types, and keeps every test and assertion
- **THEN** protection passes

#### Scenario: Deleted test file

- **WHEN** a later step deletes the protected test file
- **THEN** the attempt fails naming the file

### Requirement: New errors only

A gate with `newErrorsOnly: tsc` or `newErrorsOnly: eslint` SHALL parse the command's complete output in that tool's
format (`tsc`: `file(line,col): error TSnnnn: message`; `eslint`: the built-in `json` formatter, counting severity 2
only), including when it is longer than the output kept for display. Errors SHALL
be compared as counts per file, code or rule, and message, ignoring line and column; an error is new when the step's
result has more of it than the baseline. A file renamed by a step SHALL be compared with the baseline of its old
name. The baseline of a command without `{files}` SHALL be taken once per run at the run's base commit and reused on
resume for the same base; the baseline of a command with `{files}` SHALL be taken on the file before its first step,
and a file created by a step SHALL have an empty baseline. The run SHALL report each baseline and its error count.

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

### Requirement: Gates leave no files behind

After the gates for a step have run, every file that the gate commands created or changed in the working copy SHALL
be put back to the step's result, so gate output never becomes part of a step's change or a commit. Linked
`node_modules` SHALL be left alone.

#### Scenario: Build info in the worktree

- **WHEN** a gate command writes `tsconfig.tsbuildinfo` into the working copy
- **THEN** the file is removed after the gates, the next attempt does not see it as a change, and it is not committed
