# Proposal

## Why

A user's config said `target: ~/geowealth/WebContent/react/app`. YAML does not expand `~`, so the tool resolved it
as a directory literally named `~` next to the config file — a confusing "not a directory" error for the most natural
way to write a path to one's own project.

## What Changes

- A `target` that is `~` or starts with `~/` resolves against the user's home directory.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration`: `target` accepts a home-relative path.

## Impact

- `src/config/load.ts`, tests.
