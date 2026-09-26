# Spec Delta

## ADDED Requirements

### Requirement: Class-to-function options

The `class-to-function` step SHALL accept `testCommand` (default `{testRunner} --findRelatedTests {file}`), the
command its model runs to execute the tests related to the file, and `requireTests` (default true). When
`class-to-function` is enabled, `requireTests` is true and `characterize-tests` is disabled, the run SHALL refuse to
start and say why.

#### Scenario: Converting without tests

- **WHEN** `class-to-function` is enabled and `characterize-tests` is disabled
- **THEN** the run refuses to start, naming both steps and `steps.class-to-function.requireTests`

#### Scenario: Explicit opt-out

- **WHEN** the same configuration sets `steps.class-to-function.requireTests: false`
- **THEN** the run starts
