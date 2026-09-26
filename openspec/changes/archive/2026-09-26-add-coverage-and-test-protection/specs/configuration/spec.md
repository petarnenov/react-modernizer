# Spec Delta

## MODIFIED Requirements

### Requirement: Model and step options

The configuration SHALL set the model used by model steps (`model.default`, default `claude-sonnet-5`), the reasoning
effort (`model.effort`, one of `low`, `medium`, `high`, `xhigh`, `max`, default `high`), and per step an optional
`model` override. The `characterize-tests` step SHALL accept `testCommand` (default `{testRunner} {testFile}`), the
command its model runs to execute the tests, and `helpers`, a list of test helper files for the model to use.

#### Scenario: Defaults

- **WHEN** `model` and the step's options are not configured
- **THEN** model steps use `claude-sonnet-5` at effort `high`, and `characterize-tests` runs `{testRunner} {testFile}` with no helpers

#### Scenario: Per-step model

- **WHEN** `steps.characterize-tests.model` is `claude-opus-5`
- **THEN** that step uses `claude-opus-5` while other model steps use `model.default`

#### Scenario: Invalid effort

- **WHEN** `model.effort` is `extreme`
- **THEN** the configuration is rejected with an error naming `model.effort`

## ADDED Requirements

### Requirement: One test runner

The configuration SHALL name the command that runs the target's tests once, as `testRunner` (default
`CI=true npx react-scripts test --watchAll=false`, which is how a Create React App project runs Jest). Every command
that runs tests — gate commands, the `characterize-tests` test command and the coverage gate — SHALL be able to refer
to it as `{testRunner}`, and the default commands SHALL do so. `gates.coverage.min` SHALL accept 0 to turn the
coverage gate off.

#### Scenario: Create React App by default

- **WHEN** `testRunner` is not configured
- **THEN** the default test gate runs `CI=true npx react-scripts test --watchAll=false --findRelatedTests` with the changed files

#### Scenario: Project that runs Jest directly

- **WHEN** `testRunner` is `npx jest --ci`
- **THEN** the test gate, the step's test command and the coverage gate all run `npx jest --ci`

#### Scenario: Coverage off

- **WHEN** `gates.coverage.min` is 0
- **THEN** no coverage is measured
