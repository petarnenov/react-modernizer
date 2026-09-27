# Tasks

## 1. Configuration

- [x] 1.1 Remove `git` from `src/config/schema.ts` and add `git.branch` and `git.base` to `REMOVED_OPTIONS` in `src/config/load.ts`; verify with a test in `test/config.test.ts` that `git.branch: modernizer/pilot` is rejected naming `git.branch` and the hint

## 2. Current branch

- [x] 2.1 Add `runBranchName` and replace `RunBranch` with a run branch opened by `openRunBranch` in `src/run/workspace.ts`: refuse detached HEAD and uncommitted tracked changes (before any checkout), create or check out `<current>-modernized`, report how many commits it is behind its original, and `append()` that builds the commit as now and advances with `merge --ff-only` at the repo root with hooks off; verify in `test/workspace.test.ts`: `runBranchName('feature/x')` and `runBranchName('feature/x-modernized')`, a new branch is created from the current one and checked out, an existing one is checked out unchanged and its lag reported, append moves the checked-out branch and the working tree, a dirty file the commit touches fails append with the reason and keeps the edit, a moved HEAD is retried
- [x] 2.2 In `src/run/runner.ts` use the run branch for the state, worktrees and summary; verify in `test/run.test.ts`: dirty tracked file refuses with no branch created, untracked file runs, detached HEAD refuses, an accepted file is on `main-modernized` and in the working tree while `main` is unchanged, a second run continues on `main-modernized`
- [x] 2.3 In `src/run/status.ts` and `src/run/state.ts` use `runBranchName` of the current branch; verify in `test/run.test.ts` that `status` prints `main-modernized` and that a run from another branch does not reuse its state

## 3. Tests and docs

- [x] 3.1 Add a helper for the state path in `test/helpers/repo.ts` and move every test from `modernizer/run` to `main-modernized`; verify with `npm test`
- [x] 3.2 Update `src/cli.ts` help text, README and docs/design.md ("Run, state and resume") to the `<current>-modernized` model; verify by grepping for `git.branch`, `git.base` and `modernizer/run`, which should give no hits outside the archive
- [x] 3.3 Run `npm run verify` and confirm it passes
