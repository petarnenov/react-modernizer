## MODIFIED Requirements

### Requirement: One test runner

The configuration SHALL name the command that runs the target's tests once, as `testRunner` (default
`CI=true npx react-scripts test --watchAll=false`, which is how a Create React App project runs Jest). Every command
that runs tests — gate commands, the `characterize-tests` test command and the coverage gate — SHALL be able to refer
to it as `{testRunner}`, and the default commands SHALL do so. The default test gate SHALL be
`{ run: '{testRunner} --findRelatedTests {files}', newErrorsOnly: jest }`, so tests that already failed before a step
do not fail it. `gates.coverage.min` SHALL accept 0 to turn the coverage gate off.

#### Scenario: Create React App by default

- **WHEN** `testRunner` is not configured
- **THEN** the default test gate runs `CI=true npx react-scripts test --watchAll=false --findRelatedTests` with the changed files, judged by new failing tests only

#### Scenario: Project that runs Jest directly

- **WHEN** `testRunner` is `npx jest --ci`
- **THEN** the test gate, the step's test command and the coverage gate all run `npx jest --ci`

#### Scenario: Coverage off

- **WHEN** `gates.coverage.min` is 0
- **THEN** no coverage is measured
