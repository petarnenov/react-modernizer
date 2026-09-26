# Proposal

## Why

The only model provider is Anthropic. The user wants to run the pilot on `gpt-oss:120b` on Ollama Cloud, where they
already have an API key and a free tier. The steps already talk to the model through the `ModelClient` interface,
so a second provider is one more implementation of that interface, chosen by configuration.

## What Changes

- New `model.provider`: `anthropic` (default) or `ollama`.
- With `ollama`, `model.default` defaults to `gpt-oss:120b`. `model.baseUrl` defaults to `https://ollama.com` and can
  point at a local Ollama. The bearer key is read from the environment variable named by `model.apiKeyEnv`
  (default `OLLAMA_API_KEY`) and is never written in the config file.
- An Ollama model client that uses Ollama's native `/api/chat` with tools through Node's built-in `fetch`, so there
  is no new dependency. It provides the same tools, rate limit, per-file token budget, usage recording and credential
  preflight as the Anthropic client.
- `model.effort` maps to Ollama's `think` level: `low`, `medium`, `high`, with `xhigh` and `max` capped at `high`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration`: the model options gain `provider`, `baseUrl` and `apiKeyEnv`, and the default model depends on the
  provider.
- `model-access`: the credential check covers the Ollama key. A new requirement defines how the Ollama provider runs
  tools, counts usage and fails.

## Impact

- `src/config/schema.ts`, `src/model/ollama.ts` (new), `src/steps/registry.ts`, `src/run/runner.ts` (client choice),
  tests, `README.md`, `modernizer.config.example.yaml`, `DECISIONS.md`.
- No new package. No change for existing Anthropic configurations.
