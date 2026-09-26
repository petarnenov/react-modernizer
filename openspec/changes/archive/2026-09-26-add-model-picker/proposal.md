# Proposal

## Why

The model is fixed in the config file. To try another Ollama Cloud model, the user edits YAML by hand and guesses
the exact name. A wrong name is found only when the run's preflight fails. The catalog changes often, so the user
wants to choose from what the provider offers right now, when starting a run.

## What Changes

- `run --pick-model` opens an interactive picker before the run starts. The list comes live from the provider:
  Ollama's `/api/tags`, or the Anthropic Models API.
  - Typing filters the list; every typed word must appear in the name, in any order and case.
  - ↑/↓ move the selection, Enter chooses, Esc or Ctrl-C cancels without running.
  - The configured model is preselected.
  - Each row shows the name and, when the provider gives them, the size and date. The newest models come first.
- `run --model <name>` sets the model without the picker, e.g. for scripts. The name is checked by the usual preflight.
- The chosen model replaces `model.default` for this run only; the file is not changed. Per-step `model` overrides
  still apply, and the run says so when they exist.
- New `models [config]` command: prints the provider's current model list; `--json` gives machine-readable output.
- `--pick-model` outside a terminal fails with a message pointing to `--model`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration`: `run` accepts `--model` and `--pick-model` as overrides of `model.default`.
- `model-access`: a model client can list the provider's current models; new `models` command and interactive picker.

## Impact

- `src/model/client.ts` (`listModels`), `src/model/ollama.ts`, `src/model/anthropic.ts`.
- New `src/cli/pick.ts` (a dependency-free terminal picker using `node:readline` keypress events).
- `src/cli.ts` (`--model`, `--pick-model`, `models`), `src/bin.ts` (stdin for the picker), `src/config/load.ts`
  (`applyOverrides`).
- Tests, README, DECISIONS.md. No new package.
