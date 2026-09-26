# Spec Delta

## ADDED Requirements

### Requirement: Model and step options

The configuration SHALL set the model used by model steps (`model.default`, default `claude-sonnet-5`), the reasoning
effort (`model.effort`, one of `low`, `medium`, `high`, `xhigh`, `max`, default `high`), and per step an optional
`model` override. The `characterize-tests` step SHALL accept `testCommand` (default `npx jest --ci {testFile}`), the
command its model runs to execute the tests, and `helpers`, a list of test helper files for the model to use.

#### Scenario: Defaults

- **WHEN** `model` and the step's options are not configured
- **THEN** model steps use `claude-sonnet-5` at effort `high`, and `characterize-tests` runs `npx jest --ci {testFile}` with no helpers

#### Scenario: Per-step model

- **WHEN** `steps.characterize-tests.model` is `claude-opus-5`
- **THEN** that step uses `claude-opus-5` while other model steps use `model.default`

#### Scenario: Invalid effort

- **WHEN** `model.effort` is `extreme`
- **THEN** the configuration is rejected with an error naming `model.effort`
