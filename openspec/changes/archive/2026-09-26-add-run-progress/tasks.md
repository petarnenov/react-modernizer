# Tasks

## 1. Events

- [x] 1.1 `src/run/progress.ts`: `ProgressEvent`, `PlainProgress`, `TerminalProgress`, tool-detail whitelist
- [x] 1.2 Runner: phase events (scan, model check, worktrees), `file-start` with index/total, `file-end` with duration and tokens
- [x] 1.3 Transaction: `step-start`, `retry`; gates: `gate-start`/`gate-end` via `onGate`
- [x] 1.4 `ToolRunRequest.progress`, `StepContext.progress`; both clients emit `model-turn`, `tool-call`, `rate-wait` (`RateLimiter.acquire(onWait)`); the five steps pass it through

## 2. CLI and docs

- [x] 2.1 `run` picks the renderer by TTY; stops it in `finally`
- [x] 2.2 Tests: event order for a scripted run, no content in tool details, plain renderer format, terminal renderer redraw
- [x] 2.3 README; `npm run verify` green
