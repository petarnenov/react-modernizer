# Proposal

## Why

Accepted files are committed to a separate run branch (`modernizer/*`) that nobody merges. After the pilots the only
file migrated to TypeScript sat on `modernizer/pilot-one-all`, invisible from the branch the user works on. When the
target moved to `master` the result was effectively lost. Every pilot also needed its own YAML just to name a branch.
The user works on a branch of their own choosing and wants the results next to it, in a branch they can see,
review and merge, while their own branch stays clean.

## What Changes

- **BREAKING** A run creates `<current>-modernized` from the current branch (e.g. `feature/GEO-12345` →
  `feature/GEO-12345-modernized`) and checks it out. Accepted files are committed there, one commit per file, and
  the working tree follows each commit. The original branch is left untouched. If `<current>-modernized` already
  exists, the run checks it out and continues on it. If the current branch already ends in `-modernized`, the run
  continues on it.
- **BREAKING** A run refuses to start when HEAD is detached, and when tracked files under the target have
  uncommitted changes. That replaces the current warning.
- **BREAKING** `git.branch` and `git.base` are removed from the configuration. A config that still sets them is
  rejected with a hint to delete the line.
- Run state and worktrees are keyed by the `-modernized` branch. Starting from another branch starts or resumes that
  branch's own run.
- `status` reports the `-modernized` branch that belongs to the current branch.
- When a `-modernized` branch is resumed while its original branch has moved on, the run says how many commits
  behind it is. It does not merge them.
- If the checkout cannot take a commit (the user changed or created one of its files during the run), that file
  fails with the reason and the run continues. Nothing in the user's checkout is overwritten.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution`: where accepted files are committed, the start-up checks on the checkout, what resume is keyed
  by, and what `status` prints.
- `configuration`: `git.branch` and `git.base` are removed.

## Impact

- `src/run/workspace.ts` (`RunBranch`), `src/run/runner.ts`, `src/run/status.ts`, `src/run/state.ts`
- `src/config/schema.ts`, `src/config/load.ts` (removed options), `src/cli.ts` (help text)
- Tests that name `modernizer/run` or its state path: run, workspace, baseline, focus, config and the step tests
- README and docs/design.md ("Run, state and resume")
- The existing `pilot-*.yaml` files set `git.branch` and will be rejected. They are local, untracked files.
