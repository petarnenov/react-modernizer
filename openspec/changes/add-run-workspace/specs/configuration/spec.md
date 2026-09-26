# Spec Delta

## ADDED Requirements

### Requirement: Run branch and gate timeout

The configuration SHALL name the branch accepted files are committed to (`git.branch`, default `modernizer/run`)
and the commit it starts from when it does not exist yet (`git.base`, default `HEAD`). It SHALL set how long one
gate command may run (`gates.timeoutSeconds`, default 600, at least 1).

#### Scenario: Defaults

- **WHEN** `git` and `gates.timeoutSeconds` are not configured
- **THEN** the run branch is `modernizer/run`, it starts from `HEAD`, and a gate command may run for 600 seconds

#### Scenario: Invalid timeout

- **WHEN** `gates.timeoutSeconds` is 0
- **THEN** the configuration is rejected with an error naming `gates.timeoutSeconds`
