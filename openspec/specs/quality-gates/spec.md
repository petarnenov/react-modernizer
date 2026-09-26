# quality-gates Specification

## Purpose

Decides whether a file's change is accepted: the project's own checks must pass on it, and the change must not
bring in the shortcuts a model takes when it cannot make a check pass.

## Requirements

### Requirement: Gate commands

After the steps have changed a file, each configured gate command SHALL run in that file's isolated working copy,
in order, with `{files}` replaced by the changed files, each quoted for the shell. The gates SHALL pass only when
every command exits zero. When a command fails, the gates SHALL stop at it and report its name and output. With no
changed files, `{files}` SHALL be replaced by the file being processed.

#### Scenario: All commands pass

- **WHEN** every gate command exits zero
- **THEN** the gates pass

#### Scenario: A command fails

- **WHEN** the second of three commands exits non-zero
- **THEN** the gates fail, the third command does not run, and the failure names the second command and carries its output

#### Scenario: File names with spaces

- **WHEN** a changed file is `src/My Card.jsx`
- **THEN** the command receives it as one argument

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
