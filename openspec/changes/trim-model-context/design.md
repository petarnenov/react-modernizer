# Design

## Context

`OllamaModelClient.runTools` keeps every message and sends them through `compact(messages, turn)`, which turns tool
results older than two turns into notes. Assistant messages are sent unchanged, `thinking` included. Steps do not
tell the client which files are theirs. `js-to-ts` builds its `run_tests` command by replacing `{file}` in
`testCommand`.

## Decisions

- **`ToolRunRequest.ownFiles?: readonly string[]`.** Each step passes its file and, when it has one, its test:
  - analyze: file + existing test;
  - characterize-tests: file + characterization test;
  - class-to-function and simplify: file + tests;
  - js-to-ts: renamed file + renamed test.

  The Anthropic client ignores it (caching covers it).

- **Compaction rule** (pure function, tested without a server):
  1. A tool message whose tool is `read_file` and whose path is in `ownFiles` is kept in full if it is the latest
     read of that path; otherwise it is compacted by age as before, or immediately when a later read of the same
     path exists.
  2. Assistant messages from turns older than the last two lose `thinking`. `content` and `tool_calls` stay, so
     the tool results still pair with their calls.

  Tool messages carry `path` alongside `turn` and `note`, set when the result is recorded. Assistant messages carry
  their `turn`.

- **`{testFile}` in `js-to-ts`:** replaced with the shell-quoted renamed test path. With no test and `{testFile}` in
  the command, `run_tests` returns `no characterization test for <file>; nothing to run` without spawning anything.
  A user-configured command without `{testFile}` behaves as before.

## Risks / Trade-offs

- Dropping old `thinking` loses some continuity of reasoning. The model's own summary text and the recent turns
  keep enough; Ollama accepts assistant messages without `thinking`.
- Keeping own files in full costs their size per request. That is still smaller than re-reading, which costs a turn
  plus the size.
