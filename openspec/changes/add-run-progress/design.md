# Design

## Context

`runModernizer` takes a `log(line)` callback and calls it at three points: resume, the file result, and the summary.
The model clients, the gates and the transaction loop report nothing. Model clients are shared by all workers, so an
event from them must say which file it belongs to.

## Decisions

- **One typed event stream.** `ProgressEvent` is a union: `phase`, `file-start`, `step-start`, `model-turn`,
  `tool-call`, `rate-wait`, `gate-start`, `gate-end`, `retry`, `file-end`. Each file-scoped event carries `file`
  (and `worker`). `RunOptions.progress?: (e: ProgressEvent) => void` sits next to `log`. The existing `log` lines
  stay, so tests and the summary are unchanged.
- **Threaded through the context, not globals.** `StepContext.progress` is scoped to the file and step. Steps pass it
  as `ToolRunRequest.progress`. The clients call it:
  - `model-turn` before each request;
  - `tool-call` per tool call;
  - `rate-wait` when `RateLimiter.acquire` would wait.
    `acquire` gains an optional `onWait(ms)`. `runGateCommands` gets an optional `onGate` for start and end.
- **Tool-call detail is a whitelist.** Only `path`, or `line` for `report_bug`, is shown, never `content` or `reason`.
  A tool's input is otherwise not printed.
- **Two renderers in `progress.ts`.**
  - `TerminalProgress` is used when stdout is a TTY. It redraws a block of one line per active worker every 100 ms:
    spinner, `[i/n]`, short file name, step, attempt, last activity, elapsed time. It clears the block, prints
    permanent lines above it (step passed, gate result, file result), then redraws.
  - `PlainProgress` prints `HH:MM:SS <event>` lines.
  - The CLI picks by `process.stdout.isTTY`. `NO_COLOR` and `TERM=dumb` get the plain one.
- **The file result line** gains `(1m42s · 18.4k tokens)`.
- **No new dependency**: ANSI `\r`, `\x1b[K` and `\x1b[<n>A` are enough.

## Risks / Trade-offs

- Output interleaving with other writes to stdout: all run output goes through the renderer, which owns the terminal
  while the run lasts.
- The timer must not keep the process alive: `unref()`, and `stop()` in `finally`.
