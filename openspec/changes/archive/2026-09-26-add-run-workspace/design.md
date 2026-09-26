# Design

## Context

See proposal.md for why. What exists: config (with `retry`, `gates.commands`, `gates.forbid`, `concurrency.gates`),
the import graph and `plan`, the `Scheduler` and `runPool`, and a CLI `main(argv, io)`. `run` is a stub. The target
is a git repository, possibly a subdirectory of one (monorepo), with its dependencies in `node_modules`.

## Goals / Non-Goals

**Goals:**

- A loop that can run unattended for days over thousands of files and be interrupted at any point without losing
  or duplicating work.
- One code path for one worker and for many.
- Zero writes to the user's working tree, index or current branch.

**Non-Goals:**

- Any model step (next changes). Coverage and test-protection gates (need the test step).
- Pull requests and batching; pushing the run branch.
- Building the graph from the run branch instead of the working tree.

## Decisions

### 1. Everything lives in the target's git directory

`<git-common-dir>/modernizer/runs/<branch>/` holds `state.json` and `worktrees/w1…wN`. Inside `.git` nothing shows
up in `git status` of the user's checkout, it is removed with the repository, and it needs no `.gitignore` entry in
a codebase that is not ours. `<branch>` is sanitised (`/` → `__`) so two run branches never share state.

### 2. Worktrees per worker, merged with `git merge-tree`

Each worker owns a detached worktree. For each file it resets the worktree to the current run-branch tip, applies
the steps, runs the gates, and commits in the worktree. The commit is then added to the run branch without any
checkout: `git merge-tree --write-tree --merge-base <tip it started from> <current tip> <worker commit>` gives the
combined tree, `git commit-tree` makes the commit on the current tip, and `git update-ref <branch> <new> <old>`
moves the branch only if nobody moved it meanwhile (retried if they did). A merge conflict means two workers changed
the same lines: the file is failed, never half-applied.

- _Alternative rejected — an integration worktree and `cherry-pick`:_ a second checkout to keep clean, and a
  cherry-pick that stops half-way on conflict and must be aborted.
- **Requires git ≥ 2.38** (`merge-tree --write-tree`); checked at start with a clear message.

With one worker the merge is always trivial — the tip has not moved — so the default path is the simplest one.

### 3. `node_modules` is linked, never copied or committed

Each worktree gets a symlink to the target's `node_modules`, so eslint, tsc and jest run in the worktree exactly as
in the target. Staging and cleaning exclude it by pathspec (`:(exclude)node_modules`, `clean -e /node_modules`),
because a symlink is not matched by a `node_modules/` ignore rule.

### 4. The per-file transaction

```
reset worktree to tip
for each enabled step:
    attempt 0..perStep: step.run(ctx with previous failure) → stage → gates
        pass → next step; fail → keep output, retry with failure
    exhausted → reset worktree, record failed (revert-and-report) or stop
changes staged? commit, merge into run branch : record done without a commit
```

Gates run after each step so a failure is attributed to the step that caused it. A step's retry builds on its own
previous output, which is how a model fixes a lint error rather than starting over. An exception in a step is a
failed attempt with the error message as the failure. Changes are staged in the worker's own index; the diff for
`forbid` is `git diff --cached -M -U0`, so a `.jsx` → `.tsx` rename shows only the lines that actually changed.

With no step enabled, the gates run once on the unchanged file: a baseline of what already passes.

### 5. Gates

Commands run with `sh -c` in the worktree (at the target's subdirectory), `{files}` replaced by the changed files
that still exist, each single-quoted. Each runs in its own process group so a timeout kills jest's workers too
(`kill(-pid)`). Output is kept to the last 20 000 characters. A shared semaphore sized `concurrency.gates` limits
gate commands across workers.

Forbidden patterns are plain substrings, matched on added lines only.

### 6. State

`state.json`: `{ version, branch, base, updatedAt, files: { [path]: { status, attempts, commit?, reason? } } }`,
written to a temporary file and renamed, after every file. On start the runner loads it, and marks done and failed
files settled in the scheduler (`Scheduler.settle`). `--fresh` deletes it; the run branch keeps its commits.

### 7. Steps

```ts
interface Step {
  id: StepId;
  run(ctx: { file; cwd; attempt; previousFailure? }): Promise<void>;
}
```

A registry maps step ids to implementations; it is empty in this change. The runner takes the registry as a
parameter, so tests supply fake steps that edit files. `run` refuses to start while an enabled step is missing from
the registry.

### 8. Stopping

`runPool` gains an optional `shouldStop()`: once true, no new file is started and running ones finish. `onFail:
stop` sets it. Exit codes: 0 all settled, 3 stopped, 1 invalid configuration, target or repository.

### 9. Module layout

```
src/run/git.ts          execFile wrapper, version check, repo facts
src/run/workspace.ts    run branch, worktrees, reset, stage, commit, merge into branch
src/run/gates.ts        commands with timeout + semaphore, forbidden patterns
src/run/state.ts        load, save atomically, settle
src/run/transaction.ts  one file through the steps and gates
src/run/runner.ts       ties it together, progress, summary
src/steps/step.ts       Step, StepContext, registry
```

## Risks / Trade-offs

- [The graph is built from the working tree, not the base commit] → Files are identified by their original paths
  and the base is normally the checkout's `HEAD`; a warning is printed when the working tree has uncommitted
  changes.
- [A step that changes files other than its own] → Allowed in this change; the merge catches conflicts. A later
  gate can restrict it.
- [Gate commands are shell strings from the config] → They come from the user's own config file, run in the user's
  own codebase; documented, not sandboxed.
- [A crash between commit and state write] → The commit is on the branch but the file reads as pending; it is
  processed again, finds nothing to change or re-applies an equivalent change. The duplicate is harmless.
