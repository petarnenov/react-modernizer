# run-execution Specification

## Purpose

Runs the per-file pipeline over a whole codebase safely and unattended: every file in isolation, accepted only
through the gates, one commit per accepted file on a branch of its own, failures reverted and reported, and a run
that can be interrupted and resumed.

## Requirements

### Requirement: Accepted files land on the modernized branch

A run SHALL commit accepted files onto the run branch: `<current>-modernized`, where `<current>` is the branch
checked out in the target when the run starts, or the current branch itself when its name already ends in
`-modernized`. Before anything else touches the checkout, a run SHALL refuse to start, saying why, when HEAD is
detached or when any tracked file under the target has uncommitted changes, staged or not. Untracked files SHALL NOT
stop a run. The run SHALL then check out the run branch — created from the current branch when it does not exist,
continued as it is when it does — and bring the checkout up to each new commit, so that accepted files are in the
user's working tree as soon as they are accepted. The original branch SHALL NOT change. When a continued run branch
does not contain every commit of its original branch, the run SHALL say how many commits it is behind and SHALL NOT
merge them. When the checkout cannot take a file's commit — because the user changed the branch or a file the commit
touches while the run was going — the file SHALL be recorded as failed with that reason and nothing in the user's
working tree SHALL be overwritten. Each worker SHALL work in its own git worktree. Run state SHALL be kept inside the target's git
directory. Worktrees SHALL be kept outside the target's repository and outside any `.git`, `.hg`, `.sl` or
`node_modules` directory, because tools such as Jest ignore files there; when the only available location is inside
one, the run SHALL refuse to start and say why. A target that is not a git repository SHALL be refused.

#### Scenario: Accepted file lands on the modernized branch

- **WHEN** the user has `feature/x` checked out and a run accepts `src/Card.jsx` as `src/Card.tsx`
- **THEN** `feature/x-modernized` is created from `feature/x` and checked out, it gains the commit, `src/Card.tsx` is in the user's working tree with `src/Card.jsx` gone, and `feature/x` is unchanged

#### Scenario: Existing modernized branch

- **WHEN** `feature/x-modernized` already has two accepted files and the user starts a run from `feature/x`
- **THEN** `feature/x-modernized` is checked out as it is and the run continues on it

#### Scenario: Already on a modernized branch

- **WHEN** the user has `feature/x-modernized` checked out and starts a run
- **THEN** the run continues on `feature/x-modernized` and no `feature/x-modernized-modernized` is created

#### Scenario: Original branch moved on

- **WHEN** `feature/x` gained three commits since `feature/x-modernized` was created and a run is started from `feature/x`
- **THEN** the run says `feature/x-modernized` is 3 commits behind `feature/x` and continues without merging them

#### Scenario: Uncommitted work in the target

- **WHEN** a tracked file under the target has uncommitted changes and a run is started
- **THEN** the run refuses to start, names the changed files, creates and checks out no branch, and nothing is processed

#### Scenario: Untracked files

- **WHEN** the target has only untracked files and a run is started
- **THEN** the run starts

#### Scenario: Detached HEAD

- **WHEN** the target's HEAD is detached
- **THEN** the run refuses to start, says to check out a branch, and creates no branch

#### Scenario: Checkout changed during the run

- **WHEN** during a run the user edits `src/Card.jsx` in the working tree and the run then accepts `src/Card.jsx`
- **THEN** the file is recorded as failed with a reason naming the checkout, the user's edit is kept, and the run continues

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
written atomically. The state SHALL be kept per run branch. Running again with the same run branch SHALL resume:
files already done or failed SHALL NOT be processed again. Another run branch SHALL use its own state.
`--fresh` SHALL discard the state and start over from the files, while keeping the commits already on the branch.

#### Scenario: Resume after interruption

- **WHEN** a run is interrupted after three files and is started again from the same branch
- **THEN** those three files are not processed again and the run continues with the rest

#### Scenario: Other branch

- **WHEN** a run on `feature/x-modernized` settled three files and the user checks out `feature/y` and starts a run
- **THEN** the run on `feature/y-modernized` processes every file, and the state of `feature/x-modernized` is kept

#### Scenario: Fresh start

- **WHEN** the run is started with `--fresh`
- **THEN** every file is processed again

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

### Requirement: Status command

A `status` command SHALL print, from the state file of the current branch's run branch, that branch and the number
of files done, failed and pending, and every failed file with its reason, without running anything.

#### Scenario: Status after a run

- **WHEN** `status` is run after a run in which one file failed
- **THEN** it prints the run branch, the counts and the failed file with its reason

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

### Requirement: Files per run

The `run` command SHALL take `--files <n|all|path>`: a positive integer, `all`, or the path of one file relative to
the target; a value that is neither a positive integer nor `all` SHALL be taken as a path. Without it, a run SHALL
process one file. A run SHALL start at most that many files, taken in dependency order from the files not yet settled. Once that
many have started, no new file SHALL start, and files already in progress SHALL finish. With `all`, every file not yet
settled SHALL be processed. When the limit ends the run while files remain, the closing line SHALL say that the limit
was reached and how many files remain, and the run SHALL exit as a finished run, not a stopped one. With a path, the run SHALL process only that file,
whether or not its dependencies are settled, and SHALL process it again when it is already done or failed. A path
that is not a file the source selection picks SHALL be refused before anything runs, naming the path and whether it
was not found or not selected by `source.include`/`exclude`. Zero and negative numbers SHALL be refused before
anything runs, with a message naming `--files`.

#### Scenario: Default is one file

- **WHEN** `run` is started without `--files` on a target with ten unsettled files
- **THEN** exactly one file is processed, the closing line says 9 remain, and the exit code is 0

#### Scenario: A number of files

- **WHEN** `run --files 3` is started on a target with ten unsettled files, where `api` is imported by the others
- **THEN** three files are processed, `api` first, and seven remain

#### Scenario: Next run continues

- **WHEN** a run with `--files 3` processed three files and `run --files 3` is started again
- **THEN** the next three files are processed and the first three are not processed again

#### Scenario: All files

- **WHEN** `run --files all` is started
- **THEN** every unsettled file is processed

#### Scenario: Fewer files than the limit

- **WHEN** `run --files 50` is started with four unsettled files
- **THEN** the four files are processed and the closing line reports 0 remaining, without mentioning a limit

#### Scenario: Several workers

- **WHEN** `run --files 2 --workers 4` is started with ten unsettled files
- **THEN** two files are processed and never more than two start

#### Scenario: Invalid value

- **WHEN** `run --files 0` is started
- **THEN** the run is refused with a message naming `--files` and nothing is processed

#### Scenario: One named file

- **WHEN** `run --files src/Card.jsx` is started and `src/Card.jsx` imports `src/api.js`, which is not settled
- **THEN** only `src/Card.jsx` is processed

#### Scenario: Named file already settled

- **WHEN** `src/Card.jsx` failed in an earlier run and `run --files src/Card.jsx` is started
- **THEN** `src/Card.jsx` is processed again and its new outcome replaces the old one

#### Scenario: Path not found

- **WHEN** `run --files src/Nope.jsx` is started and there is no such file
- **THEN** the run is refused naming `src/Nope.jsx` as not found, and nothing is processed

#### Scenario: Path not selected

- **WHEN** `source.exclude` is `['src/legacy/**']` and `run --files src/legacy/Old.jsx` is started
- **THEN** the run is refused naming `src/legacy/Old.jsx` as not selected by `source.include`/`exclude`, and nothing is processed

### Requirement: Written files end with one newline

Every file a step's model writes SHALL be saved ending with exactly one newline character: a missing final newline
SHALL be added, and trailing blank or whitespace-only lines SHALL be reduced to that single newline. Everything
before the end SHALL be saved as written. Files the model does not write SHALL keep their content byte for byte.

#### Scenario: No final newline

- **WHEN** the model writes `src/Card.tsx` with content ending in `export default Card;` and no newline
- **THEN** the file on disk ends with `export default Card;` followed by one newline

#### Scenario: Trailing blank lines

- **WHEN** the model writes a test file ending in `});` followed by three newlines and a line of spaces
- **THEN** the file on disk ends with `});` followed by one newline

#### Scenario: Already one newline

- **WHEN** the model writes content that ends with exactly one newline
- **THEN** the file on disk is exactly that content
