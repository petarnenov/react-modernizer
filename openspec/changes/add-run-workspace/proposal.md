# Proposal

## Why

`plan` shows what a run would do; nothing can do it yet. Before any model is called, the run needs the machinery
that makes thousands of unattended per-file changes safe: each file worked on in isolation, accepted only when the
gates pass, committed on its own, reverted when it fails, and a run that can stop at any point and pick up where it
left off. Building this before the first model step means every step later plugs into a loop that is already proven.

## What Changes

- **`run` command** processes the files in dependency order through the enabled steps, file by file, with the
  configured number of workers.
- **Isolation**: every worker has its own git worktree of the target; the user's own checkout and branch are never
  touched. Accepted files are committed, one commit per file, on a run branch (`modernizer/run` by default) created
  from the target's `HEAD`. Worktrees and state live inside the target's `.git` directory, so they never show up as
  changes in the user's checkout.
- **Per-file transaction**: run the steps, run the gates; on a gate failure give the step the failure and retry up
  to `retry.perStep` times; then either commit, or discard every change to that file and record why
  (`revert-and-report`), or stop the run (`stop`).
- **Gates**: the configured commands, run in the worktree with `{files}` replaced by the changed files, under a
  timeout and a limit on how many run at once; and the `forbid` patterns checked on the lines the file's change
  adds. Coverage and test protection are not enforced yet — they need the test step and are a later change.
- **State and resume**: a state file records every file's outcome after each file. Running again resumes: settled
  files are not processed again. `--fresh` starts over.
- **`status` command** summarises the state of a run.
- **Steps are pluggable**: a step is code with one entry point. No step is implemented in this change; `run` refuses
  to start while an enabled step has no implementation and names it. With every step disabled, `run` checks the
  gates on each unchanged file — a baseline of what already passes.
- **Scheduler**: files settled in an earlier run can be marked settled before the run starts.

## Capabilities

### New Capabilities

- `run-execution`: the `run` and `status` commands, isolation in worktrees and a run branch, the per-file
  transaction with retries, one commit per file, state and resume.
- `quality-gates`: gate commands with the changed files, timeout and concurrency limit, and forbidden patterns in
  added lines.

### Modified Capabilities

- `configuration`: a `git` section (run branch, base) and a gate timeout.
- `file-scheduling`: files can be settled before a run starts.

## Impact

- New `src/run/` (git, workspace, state, gates, file transaction, runner) and `src/steps/` (step interface and
  registry); `src/cli.ts` gains `run` and `status`.
- `src/config/schema.ts` — `git`, `gates.timeoutSeconds`.
- `src/orchestrator/scheduler.ts` — `settle()`.
- Requires `git` ≥ 2.20 on the machine and a git repository as target.
- Writes to the target's `.git` (a branch, worktrees, `modernizer/state.json`). Never to its working tree or
  current branch.
- No model calls; no new dependencies.
