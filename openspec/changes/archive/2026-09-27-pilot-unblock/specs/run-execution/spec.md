## MODIFIED Requirements

### Requirement: Per-file transaction

For each file the run SHALL apply the enabled steps in order and run the gates after each step. When the gates
fail after a step, that step SHALL be given the gate failure and run again on its own previous output, up to
`retry.perStep` further attempts. When the gates have passed after every step, the file's changes SHALL be committed
to the run branch as one commit naming the file and the steps applied. A file whose steps apply cleanly but whose
commit cannot be combined with the run branch — because another worker changed the same lines — SHALL be recorded
as failed like any other. When the
attempts are exhausted, the file's changes SHALL be discarded and, with `retry.onFail: revert-and-report`, the file
SHALL be recorded as failed with the reason while the run continues; with `retry.onFail: stop`, the run SHALL stop
after recording it. An error inside a step SHALL be handled like a failed gate. When the last attempt ends in an
error after an earlier attempt failed the gates, the reason SHALL include that gate failure too. When an attempt
leaves the file's working copy exactly as it was when the gates last rejected it, the gates SHALL NOT run again and
no further attempt SHALL start: the file SHALL fail with that gate failure and a note that the attempt changed
nothing.

#### Scenario: Accepted file

- **WHEN** the steps change `src/Card.jsx` and the gates pass
- **THEN** the run branch gains one commit containing only that file's changes, and the file is recorded as done

#### Scenario: Retry with the failure

- **WHEN** the gates fail after a step's first attempt and pass after its second
- **THEN** the second attempt receives the first failure, the next step runs, and the file is committed once

#### Scenario: Exhausted attempts

- **WHEN** the gates still fail after `retry.perStep` retries and `onFail` is `revert-and-report`
- **THEN** nothing of that file's change is committed, it is recorded as failed with the gate failure, and the run continues

#### Scenario: Stop on failure

- **WHEN** a file fails and `onFail` is `stop`
- **THEN** no further file is started and the run reports that it stopped

#### Scenario: Unchanged file

- **WHEN** the steps change nothing and the gates pass
- **THEN** no commit is made and the file is recorded as done

#### Scenario: Budget after a gate failure

- **WHEN** the tsc gate fails a step's first attempt and the second attempt runs out of token budget
- **THEN** the file's reason names the budget and also carries the tsc gate's new errors

#### Scenario: Attempt changes nothing after a gate failure

- **WHEN** the test gate fails a step's second attempt and the third attempt only reads files and writes nothing
- **THEN** the gates do not run again, no fourth attempt starts, and the file fails with the second attempt's gate failure and a note that the third attempt changed nothing

### Requirement: Progress and summary

The run SHALL report its progress as it happens: each setup phase, the file being processed with its position in
the run, each step and attempt, each model turn and the name of every tool the model calls with the path it
concerns, waits for the rate limit, each gate command with its duration and result, and each retry with the first line of its reason — and, when that
line only introduces what follows (it ends with `:`), the first non-empty line after it too.
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

#### Scenario: Gate failure as retry reason

- **WHEN** the reason is `npx jest --findRelatedTests {files} failed:` followed by `1 new error(s); …` on the next line
- **THEN** the retry line shows both, as `… failed: 1 new error(s); …`
