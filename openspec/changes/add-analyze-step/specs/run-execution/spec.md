# Spec Delta

## MODIFIED Requirements

### Requirement: Usage and findings in the state

The state SHALL record, per file, the tokens its model steps used and the bugs its steps reported. Each finding SHALL
carry the step that reported it and, when given, a severity of `high`, `medium` or `low`. `status` SHALL show the
total tokens used by the run and the number of reported bugs per severity, and list every finding grouped by severity
— high, medium, low, then unrated — each with its file, line, step and reason.

#### Scenario: Status after a run with a reported bug

- **WHEN** a run characterised two files, used tokens for both, and one bug was reported for `src/List.jsx`
- **THEN** `status` shows the total tokens, one reported bug, and lists it under `src/List.jsx` with its reason

#### Scenario: Findings by severity

- **WHEN** `analyze` reported a high finding in `src/Cart.jsx` and a low one in `src/List.jsx`, and `class-to-function` reported an unrated one
- **THEN** `status` lists the high finding first, then the low one, then the unrated one, each naming its step
