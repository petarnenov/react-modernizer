# Spec Delta

## ADDED Requirements

### Requirement: Usage and findings in the state

The state SHALL record, per file, the tokens its model steps used and the bugs its steps reported. `status` SHALL
show the total tokens used by the run and the number of reported bugs, and list each reported bug with its file.

#### Scenario: Status after a run with a reported bug

- **WHEN** a run characterised two files, used tokens for both, and one bug was reported for `src/List.jsx`
- **THEN** `status` shows the total tokens, one reported bug, and lists it under `src/List.jsx` with its reason
