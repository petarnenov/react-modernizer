## MODIFIED Requirements

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
