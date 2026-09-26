# Spec Delta

## ADDED Requirements

### Requirement: Simplify options

The `simplify` step SHALL accept `minLines` (default 40, at least 0), the number of code lines below which a file is
not simplified; `testCommand` (default `{testRunner} --findRelatedTests {file}`); and `typecheckCommand` (default
`npx tsc --noEmit --incremental`).

#### Scenario: Defaults

- **WHEN** `simplify` is not configured
- **THEN** files under 40 code lines are skipped, tests run with `{testRunner} --findRelatedTests {file}`, and types are checked with `npx tsc --noEmit --incremental`

#### Scenario: Simplify everything

- **WHEN** `steps.simplify.minLines` is 0
- **THEN** no file is skipped for its size
