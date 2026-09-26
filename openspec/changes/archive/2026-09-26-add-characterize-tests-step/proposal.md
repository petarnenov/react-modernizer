# Proposal

## Why

Every later step — class to function, JavaScript to TypeScript, simplify — is only safe if something notices when it
changes behaviour. That something is a set of tests written against the file **as it is today**, before anything
changes. `characterize-tests` is therefore the first step that calls a model, and the one the others depend on. It
also brings in, once, everything a model step needs: the client, credentials, a narrow tool surface, a token budget
and a record of usage.

## What Changes

- **`characterize-tests` step**: for each file, a model reads the file and what it needs to understand it, writes
  React Testing Library tests of its current behaviour into one new test file next to it
  (`<Name>.characterization.test.<ext>`), runs them, and iterates until they pass on the unchanged source.
- **The step can touch nothing else.** Its tools read inside the target, write only that one test file, and run
  only the configured test command on it. Any change to another file fails the attempt. Existing tests are never
  modified.
- **Bugs are reported, not fixed.** The tests pin what the code does now, even when it looks wrong; a `report_bug`
  tool records the suspicion with the file and a reason.
- **Rules for the tests** in the step's instructions: behaviour through the rendered output and user events, not
  implementation details; no snapshots; network and time mocked at the boundary; the project's own test helpers
  (for example `renderWithProviders`) used when configured.
- **Model access** shared by all future model steps: the official Anthropic SDK, credentials checked once before a
  run starts, a shared requests-per-minute limit, a per-file token budget that stops a step that runs away, and
  token usage recorded per file.
- **Default model stays `claude-sonnet-5`**, now with adaptive thinking and a configurable effort, `high` by default.
  The model stays a per-step setting.
- **State and `status`** record and show tokens used and bugs reported.

## Capabilities

### New Capabilities

- `characterize-tests-step`: what the step produces, what it may and may not touch, the rules its tests follow, and
  how suspected bugs are reported.
- `model-access`: calling the model — credentials, rate limit, token budget, usage, refusals — for every model step.

### Modified Capabilities

- `configuration`: the default model, effort, and the step's test command and helpers.
- `run-execution`: usage and reported bugs in the state and in `status`.

## Impact

- New `src/model/` (client, rate limiter, budget) and `src/steps/characterize-tests/` (tools, instructions, step);
  `builtInSteps` gains the step.
- `src/config/schema.ts`, `src/run/state.ts`, `src/run/status.ts`, `src/run/runner.ts`.
- New dependency `@anthropic-ai/sdk` 0.128.0 (Zod is already a dependency).
- Runs cost money: each processed file makes model calls. Tests never call the network — the model is behind an
  interface with a scripted fake.
- Needs `ANTHROPIC_API_KEY` or an `ant auth login` profile to run.
