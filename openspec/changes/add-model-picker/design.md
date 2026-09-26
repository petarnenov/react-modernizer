# Design

## Context

`ModelClient` has `check` and `runTools`. Ollama's `/api/tags`, already used by `check`, returns `models[]` with
`name`, `size` and `modified_at`. The Anthropic SDK has `models.list()`, which pages newest first. The CLI's `Io`
has `stdout`, `stderr` and `terminal`; there is no input yet.

## Decisions

- **`listModels(): Promise<ModelInfo[]>` on `ModelClient`**, with `ModelInfo = { name, size?, modifiedAt? }`.
  `OllamaModelClient.check` reuses it. Anthropic: iterate `models.list()`, keeping `id` and `created_at`.
- **Dependency-free picker** (`src/cli/pick.ts`). It uses `readline.emitKeypressEvents` and raw mode, and redraws
  with ANSI like `TerminalProgress`. Inquirer or prompts would add a dependency tree for about 120 lines.
  - Pure logic, testable without a terminal: `filterModels(models, query)` (all words, any order, case-insensitive)
    and a `PickerState` reducer (type, backspace, up, down, enter, escape).
  - The terminal part only wires keypresses to the reducer and renders at most 10 rows plus a `n of m` line.
  - Raw mode is always restored in `finally`, including on Ctrl-C.
- **`Io.stdin?: NodeJS.ReadStream`**, passed by `bin.ts`. Tests give the reducer key sequences instead.
- **Override path.** `applyOverrides` gains `model`, which sets `config.model.default`. This is the same mechanism as
  `--workers`, so check-config and run agree. The picked value goes through it too.
- **Sorting:** by `modifiedAt` descending when present, then by name. Anthropic already returns newest first.
- **Cloud-tag note:** a local Ollama lists cloud models as `name:cloud`; the picker shows exactly what the server
  returns, so the chosen name is always valid for that `baseUrl`.

## Risks / Trade-offs

- Windows terminals: keypress and raw mode work in Node on Windows Terminal. The target user is on macOS.
- A very long list is filtered, not paged; 10 visible rows is enough with typeahead.
