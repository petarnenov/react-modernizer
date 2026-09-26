# Proposal

## Why

After `run` starts, nothing is printed until the first file settles. That takes minutes: the graph build, the model
check, worktree setup, then several model turns and gate commands per file. The user cannot tell a working run from
a hung one, or see where the time goes.

## What Changes

- The run reports what it is doing as it happens:
  - each setup phase (scanning source, checking model access, preparing worktrees);
  - which file of how many is being processed;
  - which step and attempt is running;
  - each model turn and the tools the model calls, with the path they touch;
  - waits for the rate limit;
  - each gate command with its duration and result;
  - retries with the reason.
- In a terminal this is a live status line per worker with a spinner and elapsed time. Finished steps, gates and
  files stay as permanent lines.
- Outside a terminal (piped, CI) every event is a plain line with a timestamp.
- The file result line gains its duration and tokens used.
- Nothing from file contents, prompts or model text is printed: only step, tool and command names, paths, counts and
  times.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution`: "Progress and summary" requires live progress during a run, not only a line per settled file.

## Impact

- New `src/run/progress.ts` (event type and the terminal/plain renderers).
- `src/run/runner.ts`, `src/run/transaction.ts` and `src/run/gates.ts` emit events.
- `ToolRunRequest` gets an optional progress callback. Both model clients report turns, tool calls and rate-limit
  waits. The five steps pass it through.
- `src/cli.ts` picks the renderer. Tests. README.
