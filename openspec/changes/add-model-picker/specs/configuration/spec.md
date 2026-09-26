## ADDED Requirements

### Requirement: Model chosen at run time

`run` SHALL accept `--model <name>`, which replaces `model.default` for that run without changing the file.
`run --pick-model` SHALL let the user choose the model interactively from the provider's current list before the run
starts, with the same effect. Per-step `model` overrides SHALL still apply, and the run SHALL name the steps that keep
their own model. `--pick-model` without an interactive terminal SHALL be refused with a message that names
`--model`.

#### Scenario: Model on the command line

- **WHEN** the file sets `model.default: glm-5.3` and the user runs `run pilot.yaml --model kimi-k2.6`
- **THEN** the run's model steps use `kimi-k2.6` and the file still says `glm-5.3`

#### Scenario: Step keeps its own model

- **WHEN** `steps.analyze.model` is set and a model is picked at run time
- **THEN** analyze keeps its own model and the run says so before the first file

#### Scenario: Picker without a terminal

- **WHEN** `run --pick-model` is started with its output piped
- **THEN** it refuses to start and says to use `--model <name>`
