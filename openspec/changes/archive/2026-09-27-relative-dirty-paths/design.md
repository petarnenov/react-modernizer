# Design

## Context

`git status --porcelain` always prints paths relative to the repository root, whatever the working directory.
`Repository.prefix` is the target relative to that root (`''` when they are the same).

## Decisions

- Strip `prefix + '/'` from each listed path. The status is already limited to `-- .` in the target, so every path
  starts with the prefix.
- _Alternative:_ `git diff --name-only --relative HEAD`. Rejected: it would need a second command for staged changes,
  and the porcelain form already covers both.
