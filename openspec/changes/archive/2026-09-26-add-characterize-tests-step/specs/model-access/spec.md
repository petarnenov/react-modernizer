# Spec Delta

## Purpose

Gives every model step the same safe, measured access to the model: checked credentials, a shared rate limit, a
per-file token budget, recorded usage, and defined behaviour when the model declines.

## ADDED Requirements

### Requirement: Credentials checked before the run

When any enabled step calls the model, the run SHALL verify before processing the first file that the model can be
reached with the configured credentials and model, and SHALL refuse to start with a message naming the problem when
it cannot.

#### Scenario: No credentials

- **WHEN** no API key or login profile is available and `characterize-tests` is enabled
- **THEN** the run refuses to start, says credentials are missing and how to provide them, and processes no file

#### Scenario: No model step enabled

- **WHEN** every enabled step works without the model
- **THEN** no credential check is made

### Requirement: Shared request rate

Model requests from all workers together SHALL NOT exceed `concurrency.requestsPerMinute`. A request over the limit
SHALL wait, not fail.

#### Scenario: Two workers at a limit of one per minute

- **WHEN** two workers each need a request within the same minute and the limit is one
- **THEN** the second request waits until the minute has passed

### Requirement: Per-file token budget

The tokens a step uses for one file SHALL be counted across all its model calls and attempts. When they reach
`budget.maxTokensPerFile`, the step SHALL stop and the attempt SHALL fail with a reason naming the budget.

#### Scenario: Runaway step

- **WHEN** a step keeps calling tools past the file's token budget
- **THEN** it is stopped and the file fails with a reason naming `budget.maxTokensPerFile`

### Requirement: Usage is recorded

Input and output tokens used for each file SHALL be recorded with the file's outcome, including for files that fail.

#### Scenario: Failed file still counts

- **WHEN** a file fails after three attempts
- **THEN** the tokens of all three attempts are recorded for it

### Requirement: Refusals and errors

A model response that declines the request SHALL fail the attempt with the reason given. A transient API error SHALL
be retried by the client before failing the attempt; any other API error SHALL fail the attempt with its message.

#### Scenario: Declined request

- **WHEN** the model declines and no fallback answers
- **THEN** the attempt fails with a reason naming the refusal
