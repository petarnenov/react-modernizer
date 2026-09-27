# Design

## Context

The CLI (`dist/bin.js`) cannot pull and rebuild itself while it runs, because the process would be executing the
files it replaces. The target path lives in the config and is resolved by `loadConfig` (including `~`). `plan` prints
a summary followed by the full order, thousands of lines on the real target. `jq` is available on the user's machine
and `shellcheck` is not.

## Goals / Non-Goals

**Goals:**

- One command, safe to run repeatedly, that never leaves the tool half-built and never forces anything in git.

**Non-Goals:**

- Any change to `run` or `plan` themselves.
- Merging, rebasing or switching branches in the target. The run's own `-modernized` handling does that.

## Decisions

- **Bash script, not a CLI command.** It has to replace `dist/` and possibly `node_modules`, which a running Node
  process cannot do to itself.
- **The body is one function called on the last line (`main "$@"; exit`).** Bash reads a script as it runs it, and
  step 1 may rewrite this very file through `git pull`. Parsing the whole function first makes the pull safe.
- **`set -euo pipefail`, and a header per stage** (`==> tool: pull`, `==> target: pull`, …). The first failure stops
  everything, and git's own message is shown.
- **`--ff-only` everywhere.** A pull that would merge or rebase fails with git's message. The script never resolves
  a divergence.
- **`npm ci` only when `package-lock.json` differs between the old and new HEAD** (`git diff --quiet A B --
package-lock.json`). A plain rebuild is seconds, a reinstall minutes.
- **Target path from the built loader:** `node --input-type=module -e` imports `./dist/config/load.js` and prints
  `loadConfig(config).target`. The path is resolved exactly as `run` resolves it, and an invalid config fails here
  with the CLI's message.
- **Target pull only with an upstream** (`git rev-parse --abbrev-ref @{u}`). Otherwise it prints `target: <branch>
has no upstream; not pulled`.
- **Plan, shortened:** `plan` output through `awk`, stopping after the summary and the first 20 files in order,
  then `… (node dist/bin.js plan <config> for all)`.
- **First argument is the config when it ends in `.yaml` or `.yml`.** Everything else goes to `run` unchanged.

## Risks / Trade-offs

- [Uncommitted work in the tool repository] → `git pull --ff-only` refuses when it would touch a changed file, and
  the script stops with git's message. It never stashes.
- [Target pull changes files under a running IDE] → Same as a manual pull. The run's own start-up check then sees a
  clean tree.
