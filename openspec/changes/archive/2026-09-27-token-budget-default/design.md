# Design

## Decisions

- **A large number, not `null`:** the option stays a positive integer, so `UsageMeter` and the schema do not change.
  One trillion is far beyond any file and well within `Number.MAX_SAFE_INTEGER`.

## Risks / Trade-offs

- [A file the model cannot finish no longer stops on tokens] → It still stops at the model-turn limit of each call
  (30–50) and after `retry.perStep` retries. A config can set a lower budget.
