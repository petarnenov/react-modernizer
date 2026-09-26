## ADDED Requirements

### Requirement: Current model list

A model client SHALL list the models its provider currently offers: name, and when the provider reports them, size
and date. The list SHALL be sorted newest first. The `models` command SHALL print that list for the configured
provider, as text or with `--json` as JSON. Listing SHALL use the same credentials as a run, and a missing or
rejected key SHALL be reported as for the run's credential check.

#### Scenario: Ollama Cloud models

- **WHEN** the provider is `ollama` and the user runs `models pilot.yaml`
- **THEN** the models from Ollama's model list are printed newest first, with size and date

#### Scenario: No key

- **WHEN** `OLLAMA_API_KEY` is not set for Ollama Cloud
- **THEN** `models` fails and names `OLLAMA_API_KEY`

### Requirement: Interactive model picker

The picker SHALL show the current model list with the configured model preselected. Typing SHALL filter the list
to models whose name contains every typed word, ignoring case and order. The up and down arrows SHALL move the
selection, Enter SHALL choose the selected model, and Escape or Ctrl-C SHALL cancel. Cancelling SHALL end the command
without running anything. When nothing matches, Enter SHALL do nothing. The picker SHALL show a bounded number of
rows and the count of matches.

#### Scenario: Typeahead

- **WHEN** the list has `glm-5.3`, `glm-5.1`, `kimi-k2.6` and `qwen3-coder:480b` and the user types `glm 5.3`
- **THEN** only `glm-5.3` is shown and Enter chooses it

#### Scenario: Cancel

- **WHEN** the user presses Escape in the picker
- **THEN** the command ends without running and without changing anything

#### Scenario: Preselected

- **WHEN** the configured model is in the list and the picker opens
- **THEN** that model is selected
