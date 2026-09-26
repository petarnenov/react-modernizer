# Design

## Context

See proposal.md for why. What exists: the run loop (`src/run/`) calls `Step.run({ file, cwd, attempt,
previousFailure })` in a worktree, then stages and runs the gates; `builtInSteps` is empty; state records outcome,
attempts, commit and reason. The target is CRA + Jest; its dependencies are linked into each worktree, so the model's
`run_tests` tool runs the project's own Jest.

## Goals / Non-Goals

**Goals:**

- A step whose model cannot change anything but its own test file, whatever it tries.
- Model plumbing (client, credentials, rate, budget, usage) written once for all later model steps.
- Deterministic, network-free tests of all of it.

**Non-Goals:**

- Coverage and test-protection gates (the next change, now that there are tests to protect).
- Cost in dollars: `budget.maxTotalCostUsd` stays unenforced — tokens are recorded, and prices change faster than
  code should.
- Prompt tuning against real codebases; that is the pilot.

## Decisions

### 1. Messages API tool runner, not the Claude Agent SDK

The official `@anthropic-ai/sdk` with `client.beta.messages.toolRunner` and `betaZodTool` tools we write. The Agent
SDK brings the full Claude Code harness with Bash and unrestricted file writes; the whole point of this step is that
the model can do exactly five things. With our own tools, "write only the test file" is a property of the code, not
a request in a prompt.

### 2. The step's tools

| Tool              | Input            | Does                                                                                     |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `read_file`       | `path`           | Reads a file inside the target, not under `node_modules` or `.git`; 200 KB cap           |
| `list_directory`  | `path`           | Lists entries inside the target                                                          |
| `write_test_file` | `content`        | Writes `<Name>.characterization.test.<ext>` — the only path it can write                 |
| `run_tests`       | —                | Runs `testCommand` with `{testFile}`, under the gate timeout; returns exit code + output |
| `report_bug`      | `line`, `reason` | Records a suspected bug                                                                  |

Paths are resolved against the worktree's target directory and rejected when they leave it (after `realpath`, so a
symlink cannot escape). Refusals are returned as tool errors (`is_error`), so the model sees why and continues.

### 3. Belt and braces: allowed changes

`Step` gains an optional `allowedChanges(file): string[]`. After a step runs, the transaction stages and fails the
attempt if any changed path is outside that list — before the gates, with the list of offending files as the
failure. The tools already make this impossible; the check makes it impossible even for a future step with a bug.

### 4. Model client behind an interface

```ts
interface ModelClient {
  check(model: string): Promise<void>; // credentials + model reachable
  runTools(request: ToolRunRequest, meter: UsageMeter): Promise<ToolRunResult>;
}
```

The real client wraps `new Anthropic()` (credentials from `ANTHROPIC_API_KEY` or an `ant` login profile, resolved by
the SDK). `check` calls `client.models.retrieve(model)`. `runTools` iterates the tool runner by hand: before each
iteration it waits on the shared rate limiter; after each message it adds `usage` to the file's meter, stops with an
error once the meter passes `budget.maxTokensPerFile`, and fails on `stop_reason: "refusal"`. Requests use
`thinking: { type: "adaptive" }`, `output_config.effort` from config, top-level `cache_control` for the stable system
prompt and tool list, and — only when a step is configured with `claude-opus-5` or a Fable model — server-side refusal
fallbacks
(`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). SDK retries (2 by default) handle 429/5xx.

Tests use a scripted `ModelClient` that calls the step's tools in a given order: no network, fully deterministic.

### 5. Per-file meter and findings in the step context

`StepContext` gains `usage: UsageMeter` and `report(bug)`. The transaction creates both per file, passes them to every
step and attempt, and returns their totals in `FileResult`; the runner stores them in the state. A thrown step still
leaves its usage in the meter, so failed files are counted.

### 6. Registry built at run time

`builtInSteps` becomes `createBuiltInSteps(config, modelClient)`, since the step needs the client and its options.
`Step` gains optional `preflight()`; the runner calls it for each enabled step before the first file, which is where
`characterize-tests` runs `check`. With no model step enabled, no client is created and no call is made.

### 7. Instructions

A fixed system prompt (cacheable) states the job and the rules — pin current behaviour, even if it looks wrong, and
report suspected bugs; test through rendered output and user events (`@testing-library/react`, `user-event` when
the project has it); no snapshots, no assertions on state or internals; mock `fetch`/API modules and timers; use the
configured helpers; keep tests deterministic; finish only when `run_tests` passes. The per-file user message names the
file, its test path, the helpers, the import graph neighbours, and on retries the previous gate failure.

### 8. Model default

`model.default` stays `claude-sonnet-5` — chosen by the project owner for cost at this scale — with `model.effort`
default `high`. The model is a per-step setting, so a pilot can compare `claude-opus-5` on this step without touching
the others.

## Risks / Trade-offs

- [Cost at 8000 files] → The per-file token budget stops runaways; usage is recorded per file so the pilot gives a
  real cost per file before scaling; the model is configurable per step.
- [Tests that pass by asserting little] → Snapshots are forbidden; coverage enforcement arrives in the next change.
  Until then, a sample of the pilot's tests is reviewed by hand.
- [Flaky tests pinned as behaviour] → The instructions forbid real timers and network; the gate reruns the tests,
  so a flaky test often fails there and is retried.
- [The model reads secrets in the target] → Reads are limited to the target and exclude `.git` and `node_modules`;
  `.env*` files are refused too. File content still goes to the API — documented.
- [SDK beta surface (tool runner)] → Isolated in one file behind `ModelClient`; a manual loop can replace it without
  touching the step.

## Open Questions

None that change the approach.
