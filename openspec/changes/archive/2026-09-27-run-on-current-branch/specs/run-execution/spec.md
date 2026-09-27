# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: The user's checkout is never touched`
- TO: `### Requirement: Accepted files land on the modernized branch`

## MODIFIED Requirements

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

### Requirement: Status command

A `status` command SHALL print, from the state file of the current branch's run branch, that branch and the number
of files done, failed and pending, and every failed file with its reason, without running anything.

#### Scenario: Status after a run

- **WHEN** `status` is run after a run in which one file failed
- **THEN** it prints the run branch, the counts and the failed file with its reason
