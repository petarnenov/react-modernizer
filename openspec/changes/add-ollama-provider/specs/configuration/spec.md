## MODIFIED Requirements

### Requirement: Model and step options

The configuration SHALL set the model provider (`model.provider`, `anthropic` or `ollama`, default `anthropic`), the
model used by model steps (`model.default`, default `claude-sonnet-5` for `anthropic` and `gpt-oss:120b` for
`ollama`), the reasoning effort (`model.effort`, one of `low`, `medium`, `high`, `xhigh`, `max`, default `high`), and
per step an optional `model` override on the same provider. For `ollama` it SHALL accept `model.baseUrl` (default
`https://ollama.com`) and `model.apiKeyEnv`, the name of the environment variable holding the API key (default
`OLLAMA_API_KEY`); the key itself SHALL NOT be configurable in the file. The `characterize-tests` step SHALL accept
`testCommand` (default `{testRunner} {testFile}`), the command its model runs to execute the tests, and `helpers`, a
list of test helper files for the model to use.

#### Scenario: Defaults

- **WHEN** `model` and the step's options are not configured
- **THEN** model steps use `claude-sonnet-5` from Anthropic at effort `high`, and `characterize-tests` runs `{testRunner} {testFile}` with no helpers

#### Scenario: Per-step model

- **WHEN** `steps.characterize-tests.model` is `claude-opus-5`
- **THEN** that step uses `claude-opus-5` while other model steps use `model.default`

#### Scenario: Invalid effort

- **WHEN** `model.effort` is `extreme`
- **THEN** the configuration is rejected with an error naming `model.effort`

#### Scenario: Ollama Cloud

- **WHEN** `model.provider` is `ollama` and nothing else under `model` is set
- **THEN** model steps use `gpt-oss:120b` at `https://ollama.com` with the key from `OLLAMA_API_KEY`

#### Scenario: Key in the file

- **WHEN** the configuration sets `model.apiKey`
- **THEN** it is rejected with an error naming `model.apiKey`
