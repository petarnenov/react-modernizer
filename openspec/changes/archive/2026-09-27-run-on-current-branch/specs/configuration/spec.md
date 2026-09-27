# Spec Delta

## MODIFIED Requirements

### Requirement: Run branch and gate timeout

The configuration SHALL set how long one gate command may run (`gates.timeoutSeconds`, default 600, at least 1).
It SHALL NOT name a branch: accepted files go to a branch derived from the target's current branch
(`<current>-modernized`). A configuration that sets `git.branch`
or `git.base` SHALL be rejected with an error naming the option and saying it was removed and the line can be
deleted.

#### Scenario: Defaults

- **WHEN** `gates.timeoutSeconds` is not configured
- **THEN** a gate command may run for 600 seconds

#### Scenario: Invalid timeout

- **WHEN** `gates.timeoutSeconds` is 0
- **THEN** the configuration is rejected with an error naming `gates.timeoutSeconds`

#### Scenario: Removed branch option

- **WHEN** the configuration sets `git.branch: modernizer/pilot`
- **THEN** it is rejected with an error naming `git.branch`, saying runs now commit to `<current>-modernized` and the line can be deleted
