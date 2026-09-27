# Design

## Context

`RunBranch` in `src/run/workspace.ts` owns `refs/heads/<git.branch>`. `ensure(base)` creates it, and `append()`
merges a worker commit onto the tip with `merge-tree`, then moves the ref with a compare-and-swap `update-ref`.
Nothing is checked out, which only works because the branch is never checked out anywhere. `runner.ts` warns on a
dirty target and keys `runDirectory` and `worktreeDirectory` by `config.git.branch`. `status.ts` reads the state
through `config.git.branch`. The target can be a subdirectory of its repository (`repo.prefix`), as in
`geowealth/WebContent/react/app`.

## Goals / Non-Goals

**Goals:**

- Accepted commits on `<current>-modernized`, checked out, with the user's working tree and index following them.
  The original branch never moves. No window in which the ref and the checkout disagree.

**Non-Goals:**

- Picking a branch or files from the command line, and cleaning up after a crash (Ctrl-C). Both are separate
  changes.
- Changing how workers build their commits. Worktrees, `merge-tree` and one commit per file stay as they are.

## Decisions

- **Advance with `git merge --ff-only <commit>` in the user's checkout instead of `update-ref`.** It moves the ref,
  the index and the working tree together. It refuses without touching anything when HEAD has moved (not a fast
  forward) or when a file it would change is dirty or untracked in the way. So it keeps the compare-and-swap safety,
  and it adds safety for the user's own files. The commit is still built by `merge-tree` + `commit-tree` onto the tip
  read just before. If the merge fails because HEAD moved, the existing loop of 5 attempts retries. A failure caused
  by the working tree ends the file with `the checkout has changes to <paths>; commit or discard them` (git's own
  message, first lines). The merge runs at `repo.root` with `-c core.hooksPath=/dev/null`, so the user's
  `post-merge` hooks do not run, as with worker commits.
  - _Alternative:_ `update-ref` followed by `read-tree -m -u`. Rejected: two steps, with a moment where the ref and
    the tree disagree, and no built-in refusal for dirty files.
- **`runBranchName(current)`**, a pure function: `current` when it already ends in `-modernized`, otherwise
  `current + '-modernized'`. That way a run started from the modernized branch continues on it instead of nesting
  suffixes.
- **Start-up order in `openRunBranch(repo, target)`.**
  1. Read `git symbolic-ref --quiet --short HEAD`. A failure means detached HEAD, and the run refuses to start.
  2. Run `git status --porcelain --untracked-files=no -- .` in the target. Any output refuses the start and lists
     the files. Both checks happen before anything touches the checkout, so a refusal leaves no branch behind.
  3. `git checkout -b <name>` when the branch does not exist, otherwise `git checkout <name>`, with hooks off. A
     checkout git refuses (an untracked file in the way) stops the run with git's message.
  4. When the branch already existed, `git rev-list --count <name>..<current>` gives how many commits it is behind
     its original. When that is more than 0, the run logs `<name> is N commits behind <current>; merge it if you
want them` and continues. It never merges on its own.

  Untracked files are allowed. A later conflict with one surfaces per file through the merge refusal above.

- **The run branch name replaces `config.git.branch` everywhere:** `runDirectory`, `worktreeDirectory`, `emptyState`
  (its `base` field becomes the tip at the start of the run), `RunSummary.branch` and `status`. `status` resolves
  `runBranchName` of the current branch without checking anything out. On a detached HEAD it says there is no
  current branch.
- **Config.** `git` is removed from the schema, which is `.strict()`, so the key would be rejected anyway. Two
  entries in `REMOVED_OPTIONS`, `git.branch` and `git.base`, give the hint `removed: runs commit to the current
branch — delete this line`.
- **Tests** switch from `modernizer/run:<path>` to `main-modernized:<path>` (`tempRepo` uses `main`), and from
  `.git/modernizer/runs/modernizer__run/` to `…/runs/main-modernized/`. A shared helper in `test/helpers/repo.ts` avoids
  repeating the path.

## Risks / Trade-offs

- [A run switches the user's checkout to another branch] → That is the request: the results should be visible. The
  original branch never changes, and `git checkout <current>` goes back. Each file is one commit on the modernized
  branch, so `git revert` undoes any of them.
- [The original branch moves on while a modernized branch exists] → The run says how far behind it is and leaves the
  merge to the user. Merging automatically could bring in conflicts in the middle of a run.
- [The user edits the working tree during a long run] → The merge refuses and that file fails with a clear reason.
  Nothing of the user's is overwritten.
- [Old run branches `modernizer/*` and their state stay behind] → They are left alone. The user deletes them with
  `git branch -D`.

## Migration Plan

Delete `git:` from existing configs. Check out the branch to work on, commit or stash, then `run`. The run switches
to `<branch>-modernized`. Old `modernizer/*` branches are left alone.
