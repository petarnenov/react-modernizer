# Proposal

## Why

Starting the agent takes several manual steps in two repositories: pull the tool, rebuild it, pull the target,
look at the plan, run. They are easy to get wrong. Today a run started against a stale target checkout found 0
files. The user wants one command.

## What Changes

- A `./modernize` script at the repository root runs, in order, stopping at the first failure:
  1. **Tool:** `git pull --ff-only` in react-modernizer. `npm ci` when `package-lock.json` changed, then
     `npm run build`.
  2. **Target:** `git pull --ff-only` on the target's current branch when it has an upstream. Otherwise it says why
     it skipped (for example on a `-modernized` branch, which has no upstream).
  3. **Plan:** `plan` for the config, showing its summary and the first files in order.
  4. **Run:** `run` with every remaining argument passed through (`--files`, `--workers`, `--model`, `--fresh`, …).
- Usage: `./modernize [config.yaml] [run options]`. The config defaults to `modernizer.config.yaml`.
- `npm run modernize -- …` does the same.
- No behaviour of the CLI changes, so no spec changes (`skip_specs: true`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- New `modernize` (bash) at the repository root, and a `modernize` entry in `package.json` scripts.
- README: the pilot guide and run examples start with `./modernize`.
- Best after `run-on-current-branch` and `run-file-count`. The script passes arguments through, so it works before
  them too, but `--files` and the `-modernized` branch come from those changes.
