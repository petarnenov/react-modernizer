# Spec Delta

## ADDED Requirements

### Requirement: Files without code

A file with no code lines, where comments and whitespace do not count, SHALL be recorded as done and unchanged
without running any step or gate and without any model call. The log line SHALL say it had no code and was skipped.
Such a file SHALL NOT count toward the number of files `--files` asks for.

#### Scenario: Empty file

- **WHEN** a run reaches `src/app/_actions/tradeHoldActions.js`, whose content is a single newline
- **THEN** it is recorded as done with no commit, no step or model is called, and the log says `· src/app/_actions/tradeHoldActions.js no code, skipped`

#### Scenario: Only comments

- **WHEN** a file contains only a license comment
- **THEN** it is skipped the same way

#### Scenario: Not counted toward --files

- **WHEN** `run --files 1` is started and the first file in order has no code and the second has code
- **THEN** the first is skipped, the second is processed, and the run ends at the limit after the second
