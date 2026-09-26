# Design

## Context

`buildGraph(target, source)` parses the included files, resolves their imports, and gives `imports` per file. The
runner inverts that into `importers`, which covers only included files. `OllamaModelClient.runTools` appends every
assistant and tool message and sends them all each turn. `processFile` keeps `previousFailure` per attempt; a step
error replaces it.

## Decisions

- **Reverse import index** (`src/graph/importers.ts`): discover every code file (`.js .jsx .ts .tsx`, not `.d.ts`,
  not `node_modules`) under the directories of `source.include` patterns (`src/` here). Read their import and
  require specifiers with `ts.preProcessFile` (TypeScript's scanner, no full parse), resolve with the existing
  resolver, and invert. It is built once per run, after the graph. Measured: 8,000 files in under a second. The runner's `importers` map comes from it; the
  graph (scheduling) stays limited to included files.
- **Prompt:** `buildPrompt` gains `importers` (paths). The system prompt gains the "fitting the importers" rule. The
  retry block adds one line when the failure names files other than the step's two: "These errors are in files you
  cannot change: adjust your types to fit them."
- **Compaction** in the Ollama loop: keep `messages` intact as the record, and build the sent list each turn. For
  each `role: tool` message belonging to a turn older than the last two, send
  `[earlier result of <tool> <path?> omitted — call it again if you need it]`. The model's assistant messages
  (with `thinking` and `tool_calls`) are always sent unchanged, so the conversation stays well-formed. Anthropic is
  not changed: prompt caching already makes resent context cheap there.
- **Reason:** track `lastGateFailure` separately from `previousFailure`. On exhausted attempts, if the final
  `previousFailure` is not a gate failure and `lastGateFailure` exists, the reason is
  `<step>: <final>\n\nlast gate failure:\n<lastGateFailure>`.

## Risks / Trade-offs

- Compaction can make the model re-read a file it needs again. That costs one small call, far less than resending
  everything each turn.
- The index adds a whole-project parse per run. The plan command does not use it.
