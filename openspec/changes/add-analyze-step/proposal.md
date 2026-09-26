# Proposal

## Why

Every step already reports suspected bugs it notices while doing something else. `analyze` is the one step whose job
is only that: a careful read of each file, before anything changes, looking for bugs and for risks that the later
steps must not trip over. Its output is a list for people — the modernisation must not fix bugs silently, but it
should not hide them either. It is the last step to implement; with it the pipeline is complete.

## What Changes

- **`analyze` step**, first in the pipeline: a model reads the file, what it imports and its existing tests, and
  reports findings. It **cannot change anything**: it has no write tool, and any change fails the attempt.
- **Grounded in the project's own linter**: the output of the configured lint command for the file (for example
  `react-hooks/exhaustive-deps` warnings) is given to the model as evidence to confirm or dismiss.
- **Findings carry a severity** (`high`, `medium`, `low`) and the step that reported them. The same severity is
  available to every step's `report_bug`.
- **`status` groups findings by severity**, highest first, each with its file, line, step and reason.
- **Cost control**: `steps.analyze.minLines` (default 0: every file) and a per-step model, so analysis can run on a
  cheaper model than the conversions.

## Capabilities

### New Capabilities

- `analyze-step`: what it looks for, what it may not do, how findings are reported.

### Modified Capabilities

- `run-execution`: "Usage and findings in the state" — findings carry severity and step; `status` groups them.
- `configuration`: `analyze` options (`lintCommand`, `minLines`).

## Impact

- New `src/steps/analyze/` (instructions, step); `report_bug` gains `severity`; `BugReport` gains `severity` and
  `step`; `src/run/transaction.ts` stamps the step; `src/run/status.ts` groups; registry.
- `src/config/schema.ts`, `modernizer.config.example.yaml`.
- No new dependency. One model call per analysed file.
