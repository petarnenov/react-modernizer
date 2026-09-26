# Tasks

## 1. Configuration and scheduler

- [x] 1.1 Add `git.branch`, `git.base` and `gates.timeoutSeconds` to the schema and the example config; verify
      config tests for "Defaults" and "Invalid timeout"
- [x] 1.2 Add `Scheduler.settle()` and `runPool`'s `shouldStop`; verify tests for "Resuming after an interruption"
      and that no file starts after a stop

## 2. Git and workspace

- [x] 2.1 `git.ts`: command wrapper, git ≥ 2.38 check, repository root, common dir, target prefix; verify tests
      against a temp repository and a non-repository ("Not a repository")
- [x] 2.2 `workspace.ts`: create or continue the run branch, add and remove worktrees with a `node_modules`
      symlink, reset, stage excluding `node_modules`, commit, merge into the branch with `merge-tree` and a
      compare-and-swap `update-ref`; verify tests for a trivial merge, a merge after the tip moved, a conflict, and
      that the user's working tree, index and branch are unchanged ("Uncommitted work in the target")

## 3. Gates

- [x] 3.1 `gates.ts` commands: `{files}` quoting, stop at first failure, timeout killing the process group,
      output cap, shared semaphore; verify tests for "All commands pass", "A command fails", "File names with
      spaces", "Hanging command" and "Limited concurrency"
- [x] 3.2 Forbidden patterns on added lines of the staged diff with rename detection; verify tests for
      "Introduced `any`" and "Existing pattern", including a `.jsx` → `.tsx` rename

## 4. Run

- [x] 4.1 `steps/step.ts` interface and empty registry; `state.ts` atomic save and load; verify a state round-trip
      test and that a partial write never leaves a corrupt file
- [x] 4.2 `transaction.ts`: steps with gates after each, retries with the previous failure, revert on exhaustion,
      commit only when something changed; verify tests for "Accepted file", "Retry with the failure", "Exhausted
      attempts", "Unchanged file" and a step that throws
- [x] 4.3 `runner.ts`: refuse unimplemented steps, build graph, resume from state, worker pool with a worktree per
      worker, progress lines, summary, `stop`, cleanup; verify tests for "Unimplemented step", "Baseline run",
      "Stop on failure", "Resume after interruption", "Fresh start", "Run with failures" and a two-worker run
      producing one commit per file
- [x] 4.4 CLI `run [config] [--workers n] [--fresh]` and `status [config]` with the specified exit codes; verify
      tests for both commands and "Status after a run"

## 5. Docs and checks

- [x] 5.1 Update README, docs/design.md status and DECISIONS.md (git ≥ 2.38, state in `.git`); verify the README
      commands run against a temp repository
- [x] 5.2 Run `npm run verify`; verify it passes
