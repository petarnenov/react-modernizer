# run-execution Specification

## Purpose

Runs the per-file pipeline over a whole codebase safely and unattended: every file in isolation, accepted only
through the gates, one commit per accepted file on a branch of its own, failures reverted and reported, and a run
that can be interrupted and resumed.

## Requirements

### Requirement: The user's checkout is never touched

A run SHALL NOT change the target's working tree, index or current branch. Accepted files SHALL be committed to the
run branch, which SHALL be created from `git.base` when it does not exist and continued when it does. Each worker
SHALL work in its own git worktree. Run state SHALL be kept inside the target's git directory. Worktrees SHALL be kept
outside the target's repository and outside any `.git`, `.hg`, `.sl` or `node_modules` directory, because tools
such as Jest ignore files there; when the only available location is inside one, the run SHALL refuse to start and
say why. A target that is not a git repository SHALL be refused.

#### Scenario: Uncommitted work in the target

- **WHEN** the user has uncommitted changes in the target and a run accepts files
- **THEN** the user's changes, current branch and index are exactly as before, and the accepted files are commits on the run branch

#### Scenario: Not a repository

- **WHEN** the target is not inside a git repository
- **THEN** the run refuses to start and says so

#### Scenario: Jest sees the worker's tests

- **WHEN** a step writes a test file in its worktree and runs Jest on it
- **THEN** Jest finds and runs the test, because the worktree path contains no `.git` directory

#### Scenario: Temp directory Jest would ignore

- **WHEN** the system temp directory is inside a `.git` directory
- **THEN** the run refuses to start and says to set `TMPDIR`

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
error after an earlier attempt failed the gates, the reason SHALL include that gate failure too.

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

### Requirement: Steps must exist

A step SHALL be code with one entry point that receives the file, its working copy, the attempt number and the
previous gate failure. The run SHALL refuse to start while an enabled step has no implementation, naming each such
step. With every step disabled, the run SHALL apply only the gates to each file.

#### Scenario: Unimplemented step

- **WHEN** `simplify` is enabled and has no implementation
- **THEN** the run refuses to start and names `simplify`

#### Scenario: Baseline run

- **WHEN** every step is disabled
- **THEN** each file is checked by the gates and recorded as done or failed, and nothing is committed

### Requirement: State and resume

After every file the run SHALL record its outcome, attempts and, for a failure, the reason, in a state file that is
written atomically. Running again with the same run branch SHALL resume: files already done or failed SHALL NOT be
processed again. `--fresh` SHALL discard the state and start over from the files, while keeping the run branch's
commits.

#### Scenario: Resume after interruption

- **WHEN** a run is interrupted after three files and is started again
- **THEN** those three files are not processed again and the run continues with the rest

#### Scenario: Fresh start

- **WHEN** the run is started with `--fresh`
- **THEN** every file is processed again

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

### Requirement: Status command

A `status` command SHALL print, from the state file, the run branch and the number of files done, failed and
pending, and every failed file with its reason, without running anything.

#### Scenario: Status after a run

- **WHEN** `status` is run after a run in which one file failed
- **THEN** it prints the counts and the failed file with its reason

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

### Requirement: A step that changes nothing is not gated

When a step leaves every file as it was, its attempt SHALL pass without running the gates: the gates judge changes,
and an unchanged file is not a change. Pre-existing problems in a file SHALL NOT fail a step that did not touch it.
With every step disabled, the gates SHALL still run on each file, as a baseline.

#### Scenario: Legacy lint errors

- **WHEN** a file already fails the lint gate and `analyze` changes nothing
- **THEN** the step passes and the file goes on to the next step

#### Scenario: Baseline run

- **WHEN** every step is disabled
- **THEN** the gates run on each unchanged file
