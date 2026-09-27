# Tasks

## 1. Runner

- [x] 1.1 In `work` (`src/run/runner.ts`) read the file from the worktree and, when `measure(...).lines` is 0, record it done (0 attempts, no commit), log `· <file> no code, skipped`, and return before `processFile` without counting it toward `--files`; verify in `test/run.test.ts`: an empty file and a comment-only file are skipped with no step call, and with `files: { kind: 'count', n: 1 }` an empty first file is skipped and the next file is processed

## 2. Verify

- [x] 2.1 Run `npm run verify` and confirm it passes
