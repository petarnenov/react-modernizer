# Spec Delta

## Purpose

Decides whether a file's change is accepted: the project's own checks must pass on it, and the change must not
bring in the shortcuts a model takes when it cannot make a check pass.

## ADDED Requirements

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
