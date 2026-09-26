# model-access Specification

## Purpose

Gives every model step the same safe, measured access to the model: checked credentials, a shared rate limit, a
per-file token budget, recorded usage, and defined behaviour when the model declines.

## Requirements

### Requirement: Credentials checked before the run

When any enabled step calls the model, the run SHALL verify before processing the first file that the model can be
reached with the configured provider, credentials and model, and SHALL refuse to start with a message naming the
problem when it cannot.

#### Scenario: No credentials

- **WHEN** no API key or login profile is available and `characterize-tests` is enabled
- **THEN** the run refuses to start, says credentials are missing and how to provide them, and processes no file

#### Scenario: No model step enabled

- **WHEN** every enabled step works without the model
- **THEN** no credential check is made

#### Scenario: Ollama Cloud without a key

- **WHEN** `model.provider` is `ollama`, `model.baseUrl` is `https://ollama.com` and `OLLAMA_API_KEY` is not set
- **THEN** the run refuses to start and names `OLLAMA_API_KEY`

#### Scenario: Ollama model not available

- **WHEN** the Ollama server does not list the configured model
- **THEN** the run refuses to start with a message naming the model

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

### Requirement: Ollama provider

With `model.provider: ollama`, model calls SHALL go to the Ollama chat API at `model.baseUrl`, with the step's tools.
Tool input SHALL be validated against the tool's schema before the tool runs, and invalid input SHALL be returned to
the model as a tool error. The rate limit and the per-file token budget SHALL apply to every request, and the
reported prompt and output tokens SHALL be recorded as usage. `model.effort` SHALL be sent as the thinking level
`low`, `medium` or `high`, with `xhigh` and `max` sent as `high`. A response cut off by the output length SHALL fail
the attempt. Rate-limit, server and network errors SHALL be retried by the client before the attempt fails.

#### Scenario: Tool call

- **WHEN** the model calls `read_file` with a valid path
- **THEN** the tool runs, its result goes back to the model, and the call continues until the model answers without tools

#### Scenario: Invalid tool input

- **WHEN** the model calls `report_bug` without `reason`
- **THEN** the tool does not run and the model receives an error naming the invalid input

#### Scenario: Effort above high

- **WHEN** `model.effort` is `max`
- **THEN** requests ask for thinking level `high`

#### Scenario: Budget

- **WHEN** a file's recorded usage reaches `budget.maxTokensPerFile`
- **THEN** no further request is made and the attempt fails naming the budget
