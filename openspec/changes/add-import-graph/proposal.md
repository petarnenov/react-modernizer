# Proposal

## Why

The scheduler orders files leaves-first, but nothing feeds it: there is no way yet to find the files of a target
codebase or what they import. Without the graph there is no order, and without an order the first real run — the
pilot — cannot start. The graph is also the first thing worth seeing on a codebase of 8000 files before any model is
called: how many files, how tangled, where the cycles are, which imports cannot be resolved.

## What Changes

- **Discovery**: find the files to process in the target from `source.include` / `source.exclude`, sorted, so the
  same codebase always yields the same set.
- **Test files are not units of work.** `*.test.*`, `*.spec.*`, `__tests__/` and `setupTests.js` are excluded by
  default; they belong to the component they test, which later steps handle together with it.
- **Import graph**: for every discovered file, the files it imports — `import`, `export … from`, dynamic `import()`
  and `require()` — resolved the way a CRA app resolves them: relative paths, omitted extensions
  (`.js`, `.jsx`, `.ts`, `.tsx`), directory `index` files, and absolute imports from `baseUrl` in `jsconfig.json` or
  `tsconfig.json`.
- **Classification of every import**: internal (a discovered file), outside the set (a project file not being
  processed, e.g. already TypeScript or excluded), asset (CSS, images, JSON), package, or **unresolved** — a path
  that should be a project file but is not found. Unresolved imports are reported, never fatal.
- **Cycles** found and reported as groups of files, so they can be fixed before the pilot or at least expected.
- **`plan` command**: prints the processing order the scheduler would follow and the graph's statistics, as text or
  JSON, without changing anything in the target.

## Capabilities

### New Capabilities

- `import-graph`: discovering the files of a target codebase, resolving their imports, classifying every import,
  and finding import cycles.
- `run-planning`: the `plan` command — the processing order and statistics, as text and JSON.

### Modified Capabilities

- `configuration`: the default `source.exclude` now leaves test files and test setup out of the units of work.

## Impact

- New `src/graph/` (discovery, import extraction, resolution, cycles) and `src/cli.ts` gains `plan`.
- `src/config/schema.ts` — new default for `source.exclude`.
- Dependencies: `typescript` moves from dev to runtime dependency (same 6.0.3) for import extraction;
  `tinyglobby` added for discovery. Recorded in DECISIONS.md.
- Read-only on the target: nothing is written there.
- No model calls, no cost.
