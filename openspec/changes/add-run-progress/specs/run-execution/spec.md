## MODIFIED Requirements

### Requirement: Progress and summary

The run SHALL report its progress as it happens: each setup phase, the file being processed with its position in
the run, each step and attempt, each model turn and the name of every tool the model calls with the path it
concerns, waits for the rate limit, each gate command with its duration and result, and each retry with its reason.
Progress output SHALL NOT include file contents, prompts or model text. In an interactive terminal it SHALL show a
live status line per active worker with the elapsed time; otherwise every event SHALL be printed as a line. The run
SHALL print one line per settled file with its outcome, duration and tokens used, and at the end a summary with the
number of files done, failed and remaining. It SHALL exit zero when every file was settled, even if some failed;
non-zero when it stopped on a failure, and when the configuration, target or repository is invalid.

#### Scenario: Run with failures

- **WHEN** a run settles every file and two failed
- **THEN** the summary reports two failed and the command exits zero

#### Scenario: Before the first file

- **WHEN** the run is building the import graph and checking model access
- **THEN** each phase is reported as it starts, before any file is processed

#### Scenario: Model working on a file

- **WHEN** the model for `analyze` on file 2 of 7 sends its third request and calls `read_file` on `src/api.js`
- **THEN** the progress shows file 2/7, the step `analyze`, turn 3 and `read_file src/api.js`, and nothing of the file's content

#### Scenario: Gate and retry

- **WHEN** `npx eslint {files}` fails after the step and the step is retried
- **THEN** the progress shows the gate command, its duration and failure, then the retry with the first line of the reason

#### Scenario: Not a terminal

- **WHEN** the output is piped to a file
- **THEN** every progress event is written as a plain line with a timestamp and no terminal control codes
