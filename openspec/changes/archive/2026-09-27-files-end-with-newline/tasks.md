# Tasks

## 1. Write tool

- [x] 1.1 In `writeOneFileTool` save `content` with trailing whitespace trimmed and one `\n` added; verify with tests in `test/tools.test.ts`: no final newline gets one, three trailing newlines and a spaces-only line become one, content with exactly one newline is written unchanged
- [x] 1.2 Verify at step level with a characterize-tests run whose scripted model writes a test without a final newline: the committed test file ends with `\n`

## 2. Verify

- [x] 2.1 Run `npm run verify` and confirm it passes
