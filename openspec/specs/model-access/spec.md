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

### Requirement: Current model list

A model client SHALL list the models its provider currently offers: name, and when the provider reports them, size
and date. The list SHALL be sorted newest first. The `models` command SHALL print that list for the configured
provider, as text or with `--json` as JSON. Listing SHALL use the same credentials as a run, and a missing or
rejected key SHALL be reported as for the run's credential check.

#### Scenario: Ollama Cloud models

- **WHEN** the provider is `ollama` and the user runs `models pilot.yaml`
- **THEN** the models from Ollama's model list are printed newest first, with size and date

#### Scenario: No key

- **WHEN** `OLLAMA_API_KEY` is not set for Ollama Cloud
- **THEN** `models` fails and names `OLLAMA_API_KEY`

### Requirement: Interactive model picker

The picker SHALL show the current model list with the configured model preselected. Typing SHALL filter the list
to models whose name contains every typed word, ignoring case and order. The up and down arrows SHALL move the
selection, Enter SHALL choose the selected model, and Escape or Ctrl-C SHALL cancel. Cancelling SHALL end the command
without running anything. When nothing matches, Enter SHALL do nothing. The picker SHALL show a bounded number of
rows and the count of matches.

#### Scenario: Typeahead

- **WHEN** the list has `glm-5.3`, `glm-5.1`, `kimi-k2.6` and `qwen3-coder:480b` and the user types `glm 5.3`
- **THEN** only `glm-5.3` is shown and Enter chooses it

#### Scenario: Cancel

- **WHEN** the user presses Escape in the picker
- **THEN** the command ends without running and without changing anything

#### Scenario: Preselected

- **WHEN** the configured model is in the list and the picker opens
- **THEN** that model is selected

### Requirement: Ollama history compaction

With the Ollama provider, a tool result older than the two most recent model turns SHALL be replaced, in the
messages sent to the model, by a one-line note naming the tool and the path it concerned and saying the tool can be
called again, except the latest result of reading each file, which SHALL always be sent in full. An earlier read of
the same file SHALL be replaced by a note, since a later read supersedes it. When the model reads a file whose content
is identical to the latest read of that path it already has, the result SHALL be a short note saying the file is
unchanged since that read, which stays in full, instead of the content again. Assistant messages older than the two
most recent turns SHALL be sent without their reasoning (`thinking`), keeping their text and tool calls. The system
prompt and the task prompt SHALL be kept as they were.

#### Scenario: Long session

- **WHEN** the model is on its tenth turn and ran the tests on its second
- **THEN** the tenth request carries a note that `run_tests` was called, not the test output

#### Scenario: Recent results

- **WHEN** the model ran the tests on its last turn
- **THEN** the next request carries the full test output

#### Scenario: Own file

- **WHEN** the step works on `src/Card.js`, which the model read on its first turn, and it is on its tenth turn
- **THEN** the tenth request carries the content of `src/Card.js` from that read

#### Scenario: File read long ago

- **WHEN** the model read `src/a.ts` on its first turn and is on its tenth turn
- **THEN** the tenth request carries the content of `src/a.ts` from that read

#### Scenario: Own file read twice

- **WHEN** the model read `src/Card.js` on turn 1, wrote it on turn 4 and read it again on turn 6, and is on its tenth turn
- **THEN** the read from turn 6 is sent in full and the read from turn 1 as a note

#### Scenario: Unchanged file read again

- **WHEN** the model read `src/Percent.tsx` on turn 2 and reads it again on turn 7 without it having changed
- **THEN** the turn-7 result is a note that the file is unchanged since the read on turn 2, and the turn-2 read is still sent in full

#### Scenario: Old reasoning

- **WHEN** the model is on its tenth turn
- **THEN** its messages from turns 1 to 7 are sent without `thinking`, and those from turns 8 and 9 with it
