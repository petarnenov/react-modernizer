# Spec Delta

## ADDED Requirements

### Requirement: Analyze options

The `analyze` step SHALL accept `lintCommand` (default `npx eslint --format unix {file}`), whose output for the file is
given to the model as evidence, and `minLines` (default 0), the number of code lines below which a file is not
analysed.

#### Scenario: Defaults

- **WHEN** `analyze` is not configured
- **THEN** every file is analysed and the lint evidence comes from `npx eslint --format unix {file}`

#### Scenario: Cheaper analysis

- **WHEN** `steps.analyze.model` is `claude-haiku-4-5` and `model.default` is `claude-sonnet-5`
- **THEN** analysis uses `claude-haiku-4-5` and the other steps use `claude-sonnet-5`
