# Design

## Context

Steps reach the model only through `ModelClient` (`check`, `runTools`). `AnthropicModelClient` wraps the SDK's tool
runner. `createBuiltInSteps` builds one client per run, so one rate limiter covers all workers. The user has an
Ollama Cloud key and wants `gpt-oss:120b`, the same model maf-lab runs on (see maf-lab DECISIONS §9).

## Goals / Non-Goals

**Goals:** a second provider behind the same interface; no change for Anthropic configurations; the same guarantees
(tools, rate limit, budget, usage, preflight).

**Non-Goals:** OpenAI-compatible endpoints in general; mixing providers per step; streaming; cost in USD for Ollama.

## Decisions

- **Native `/api/chat`, not the OpenAI-compatible `/v1`.** It carries `think` levels and token counts
  (`prompt_eval_count`, `eval_count`) directly. maf-lab uses the same native API, through OllamaSharp.
- **Node's built-in `fetch`, no SDK.** The API surface is two endpoints. An `ollama` npm package would be a new
  dependency for about 150 lines of code. A `fetch`-like function is injected, so tests stub it.
- **Manual tool loop.** One request, then run each `tool_calls` entry, then append `role: tool` messages (with
  `tool_name`), then repeat. The loop stops when a response has no tool calls or after `maxIterations` requests,
  matching the Anthropic runner. The assistant message goes back exactly as returned, including `thinking`, which
  gpt-oss needs to continue its reasoning.
- **Schemas via `z.toJSONSchema`** (zod 4, already a dependency). The same zod schema validates the input with
  `safeParse` before `run`. Ollama ignores `tool_choice` (maf-lab DECISIONS §9), so nothing depends on forcing a
  tool call. Every step already judges the result by its files and gates, not by whether a tool was called.
- **Effort → `think`.** gpt-oss accepts `low` / `medium` / `high`. `xhigh` and `max` become `high`.
- **Retries.** 429, 5xx and network errors are retried twice with 2 s and 8 s backoff, like the Anthropic SDK's
  `maxRetries: 2`. A 401 or 403 is not retried.
- **Timeout** of 10 minutes per request (`AbortSignal.timeout`), so a hung connection cannot stall a worker forever.
- **Preflight: `GET /api/tags`** with the bearer key. It returns 401/403 for a bad key and lists the available
  models, so an unknown model is caught too, all without spending tokens. A missing key is an error only when
  `baseUrl` is not loopback, because a local Ollama needs no key.
- **Config shape.** `model.default` becomes optional in the schema and is resolved in a `.transform` from the
  provider, so there is still one schema and one place for defaults. `apiKeyEnv` names an environment variable. A
  key in the file is rejected by `.strict()` like any unknown key.

## Risks / Trade-offs

- **gpt-oss:120b is weaker than Claude at tool use and precise code edits.** The gates keep bad edits out, but
  expect more failed attempts in the conversion steps. Start with `analyze` and `characterize-tests`.
- **Free-tier usage limits** on Ollama Cloud. A 429 is retried and then fails the file. Lower
  `concurrency.requestsPerMinute` if it happens.
- **No prompt caching.** The system prompt is sent in full on every request. That doesn't matter for cost here, but
  it does count against the token budget.
- Not verified against the live service in CI: the tests stub `fetch`. The first real call is the pilot.
