# Tasks

## 1. Configuration

- [ ] 1.1 `model.provider` (`anthropic` | `ollama`), `model.baseUrl`, `model.apiKeyEnv`; `model.default` resolved from the provider
- [ ] 1.2 Tests: defaults per provider, key in the file rejected, invalid provider named

## 2. Ollama client

- [ ] 2.1 `src/model/ollama.ts`: `OllamaModelClient` with injected `fetch`; tool loop over `/api/chat`, schema validation, usage, budget, rate limit, effort → `think`, `done_reason: length` fails
- [ ] 2.2 Retries on 429/5xx/network, none on 401/403; 10-minute request timeout
- [ ] 2.3 `check`: missing key for a non-loopback URL, rejected key, model not listed by `/api/tags`
- [ ] 2.4 Tests with a stubbed `fetch`, one per scenario in the delta specs

## 3. Wiring and docs

- [ ] 3.1 `createModelClient(config)` picks the provider; `createBuiltInSteps` uses it
- [ ] 3.2 README (Ollama Cloud section in the pilot guide), example config, DECISIONS.md
- [ ] 3.3 `npm run verify` green
