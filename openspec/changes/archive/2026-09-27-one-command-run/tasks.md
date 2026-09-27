# Tasks

## 1. Script

- [x] 1.1 Add `modernize` (bash, executable) with `main "$@"; exit`, `set -euo pipefail` and stage headers; verify with `bash -n modernize`, and that `./modernize missing.yaml` stops at the target stage with the CLI's config error and runs nothing after it
- [x] 1.2 Tool stage: `git pull --ff-only`, `npm ci` only when `package-lock.json` changed between old and new HEAD, `npm run build`; verify by running it twice: the second run pulls nothing, skips `npm ci`, and builds
- [x] 1.3 Target stage: resolve the target through `dist/config/load.js`, pull `--ff-only` when the current branch has an upstream, otherwise print why it is skipped; verify against a temp clone with and without an upstream
- [x] 1.4 Plan and run stages: shortened `plan` (summary + first 20 files), then `run` with the config and all remaining arguments; verify with `./modernize --files 1` against the geowealth target: all four headers appear and the run processes one file

## 2. Wiring and docs

- [x] 2.1 Add `"modernize": "./modernize"` to `package.json` scripts; verify `npm run modernize -- --files 1` reaches the run stage
- [x] 2.2 Update README (pilot guide, run examples) to start with `./modernize`; verify by reading the section
- [x] 2.3 Run `npm run verify` and confirm it passes
