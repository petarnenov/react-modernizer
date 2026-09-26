# run-execution Specification

## Purpose

Runs the per-file pipeline over a whole codebase safely and unattended: every file in isolation, accepted only
through the gates, one commit per accepted file on a branch of its own, failures reverted and reported, and a run
that can be interrupted and resumed.

## Requirements

### Requirement: The user's checkout is never touched

A run SHALL NOT change the target's working tree, index or current branch. Accepted files SHALL be committed to the
run branch, which SHALL be created from `git.base` when it does not exist and continued when it does. Each worker
SHALL work in its own git worktree. Worktrees and run state SHALL be kept inside the target's git directory. A
target that is not a git repository SHALL be refused.

#### Scenario: Uncommitted work in the target

- **WHEN** the user has uncommitted changes in the target and a run accepts files
- **THEN** the user's changes, current branch and index are exactly as before, and the accepted files are commits on the run branch

#### Scenario: Not a repository

- **WHEN** the target is not inside a git repository
- **THEN** the run refuses to start and says so

### Requirement: Per-file transaction

For each file the run SHALL apply the enabled steps in order and run the gates after each step. When the gates
fail after a step, that step SHALL be given the gate failure and run again on its own previous output, up to
`retry.perStep` further attempts. When the gates have passed after every step, the file's changes SHALL be committed
to the run branch as one commit naming the file and the steps applied. A file whose steps apply cleanly but whose
commit cannot be combined with the run branch — because another worker changed the same lines — SHALL be recorded
as failed like any other. When the
attempts are exhausted, the file's changes SHALL be discarded and, with `retry.onFail: revert-and-report`, the file
SHALL be recorded as failed with the reason while the run continues; with `retry.onFail: stop`, the run SHALL stop
after recording it. An error inside a step SHALL be handled like a failed gate.

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

The run SHALL print one line per settled file with its outcome, and at the end a summary with the number of files
done, failed and remaining. It SHALL exit zero when every file was settled, even if some failed; non-zero when it
stopped on a failure, and when the configuration, target or repository is invalid.

#### Scenario: Run with failures

- **WHEN** a run settles every file and two failed
- **THEN** the summary reports two failed and the command exits zero

### Requirement: Status command

A `status` command SHALL print, from the state file, the run branch and the number of files done, failed and
pending, and every failed file with its reason, without running anything.

#### Scenario: Status after a run

- **WHEN** `status` is run after a run in which one file failed
- **THEN** it prints the counts and the failed file with its reason

### Requirement: Usage and findings in the state

The state SHALL record, per file, the tokens its model steps used and the bugs its steps reported. `status` SHALL
show the total tokens used by the run and the number of reported bugs, and list each reported bug with its file.

#### Scenario: Status after a run with a reported bug

- **WHEN** a run characterised two files, used tokens for both, and one bug was reported for `src/List.jsx`
- **THEN** `status` shows the total tokens, one reported bug, and lists it under `src/List.jsx` with its reason
