# characterize-tests-step Specification

## Purpose

Pins the current behaviour of each file with tests before anything changes it, so every later step can be checked
against what the code did before — without the step itself being able to change that code.

## Requirements

### Requirement: One characterization test file per source file

For a source file `<dir>/<Name>.<ext>` the step SHALL write its tests to `<dir>/<Name>.characterization.test.<ext>`
and to no other file. The tests SHALL pass against the unchanged source file before the step is done. When that test
file already exists from an earlier run, the step SHALL replace it.

#### Scenario: Component with no tests

- **WHEN** the step processes `src/components/Card.jsx`
- **THEN** it creates `src/components/Card.characterization.test.jsx` and the tests in it pass

#### Scenario: Existing tests are left alone

- **WHEN** `src/components/Card.test.jsx` already exists
- **THEN** it is not modified, and the characterization tests go to `Card.characterization.test.jsx`

### Requirement: The step changes nothing but its test file

The step's model SHALL be able to read files inside the target, list directories inside the target, write only the
file's characterization test file, run only the configured test command on that test file, and report suspected
bugs. A path outside the target, a write to any other path, and any change to another file SHALL be refused; a
change to another file found after the step SHALL fail the attempt.

#### Scenario: Attempt to edit the source

- **WHEN** the model asks to write `src/components/Card.jsx`
- **THEN** the write is refused with an explanation, and the source file is unchanged

#### Scenario: Path outside the target

- **WHEN** the model asks to read `../../etc/passwd` or a path under `node_modules`
- **THEN** the read is refused

#### Scenario: Other file changed anyway

- **WHEN** after the step any file other than the characterization test file differs from the start
- **THEN** the attempt fails naming the changed files

### Requirement: Tests describe behaviour

The step's instructions SHALL require tests that exercise the file through its public surface — rendered output and
user interaction for components, return values and effects for functions — and SHALL forbid snapshot assertions,
assertions on internal state or implementation details, and real network or timer use. When the configuration names
test helpers, the instructions SHALL require using them.

#### Scenario: Snapshot shortcut

- **WHEN** the model writes `toMatchSnapshot` in the test file
- **THEN** the forbidden-pattern gate fails the attempt and the model is given the failure

#### Scenario: Configured helper

- **WHEN** the configuration names `src/test-utils.js` as a helper
- **THEN** the instructions tell the model to use it and the model can read it

### Requirement: Suspected bugs are reported, not fixed

The step SHALL let the model report a suspected bug with a line reference and a reason, and SHALL record each report
with the file. Reporting a bug SHALL NOT change the tests' duty to pin current behaviour.

#### Scenario: Off-by-one in a component

- **WHEN** the model notices a list renders one item too few and reports it
- **THEN** the report is recorded against the file, and the tests assert the current output
