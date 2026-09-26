# Tasks

## 1. Listing

- [ ] 1.1 `ModelInfo`, `ModelClient.listModels`; Ollama via `/api/tags` (reused by `check`); Anthropic via `models.list()`; newest first
- [ ] 1.2 `models [config] [--json]` command
- [ ] 1.3 Tests: Ollama list and sort, missing key named, Anthropic stub, command output

## 2. Picker

- [ ] 2.1 `src/cli/pick.ts`: `filterModels`, `PickerState` reducer, terminal wiring with raw mode restored in `finally`
- [ ] 2.2 Tests: typeahead (words, any order, case), arrows bounded, Enter on no match, Escape cancels, preselection, render shows at most 10 rows and the count

## 3. Run options

- [ ] 3.1 `applyOverrides({ model })`; `run --model` and `--pick-model`; refuse `--pick-model` without a terminal; note steps with their own model
- [ ] 3.2 `Io.stdin` from `bin.ts`
- [ ] 3.3 Tests: `--model` overrides without touching the file, per-step note, no-terminal refusal
- [ ] 3.4 README, DECISIONS.md; `npm run verify` green
