# Proposal

## Why

The default `budget.maxTokensPerFile` of 200 000 is below what real files take. In the geowealth pilot a file used
283k and another 825k tokens, so a config that leaves the budget out fails most files. The user wants the budget to
be effectively unlimited by default. The model-turn limit per call and `retry.perStep` still bound each file.

## What Changes

- The default `budget.maxTokensPerFile` becomes 1 000 000 000 000 (one trillion), effectively unlimited. A value set in
  the config still applies.
- The example config shows the new default.
- No spec change: the requirement names the option, not its default (`skip_specs: true`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- `src/config/schema.ts`, `modernizer.config.example.yaml`, and a config default test.
