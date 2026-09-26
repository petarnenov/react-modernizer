# Proposal

## Why

The first real pilot spent 1,03 million tokens on one small file and failed. Worktrees lived in
`.git/modernizer/runs/…/worktrees`, and Jest's file map (`jest-haste-map`) ignores every path containing `/.git/`,
`/.hg/` or `/.sl/`. So in a worktree Jest found no tests. Every `run_tests` call and every Jest gate failed with
"No tests found", and the model kept rewriting a test that could never run until the token budget was used up. This
was reproduced with Jest 29: the same test fails in a worktree under `.git` and passes in one under the temp
directory.

## What Changes

- Worktrees move to `<system temp>/react-modernizer/<repo>-<id>/<branch>/w<N>`. They are outside the repository and
  outside any `.git`, `.hg`, `.sl` or `node_modules` directory. The id comes from the repository's git directory, so
  two repositories never share worktrees.
- A temp directory under such a directory is refused with a message to set `TMPDIR`.
- Run state (`state.json`) stays in `.git/modernizer/runs/<branch>/`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution`: worktrees are kept outside the repository and outside directories tools ignore. Only the run
  state stays in the git directory.

## Impact

- `src/run/workspace.ts` (`worktreeDirectory`), `src/run/runner.ts`, tests, README, docs/design.md, DECISIONS.md.
