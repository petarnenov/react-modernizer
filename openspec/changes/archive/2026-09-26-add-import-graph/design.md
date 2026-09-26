# Design

## Context

See proposal.md for why. What exists:

- `Scheduler` (`src/orchestrator/scheduler.ts`) takes `Map<file, imports[]>`, ignores imports outside the map, and
  hands out files in the map's insertion order among those that are ready.
- `source.include` / `source.exclude` exist in the schema (`src/config/schema.ts`) but nothing reads them.
- The CLI has `check-config` and a stub `run`.
- The target shape: Create React App, JavaScript with JSX, `baseUrl` absolute imports possible via `jsconfig.json`
  (CRA supports `baseUrl` only, not `paths`), CSS modules and image imports, around 8000 files.

## Goals / Non-Goals

**Goals:**

- A correct, deterministic graph for CRA-style codebases, built in seconds, read-only on the target.
- Every import accounted for, so resolution gaps are visible rather than silently dropped edges.

**Non-Goals:**

- Webpack aliases, `paths` mappings, Babel module-resolver, monorepo workspaces. Configurable resolution can come
  later; CRA without ejecting supports none of them.
- Type-level imports and re-export analysis beyond the module specifier.
- Detecting class components or other per-file facts; later changes add those to the plan.

## Decisions

### 1. Parse with the TypeScript compiler, not a regex or a lexer

`ts.createSourceFile` with `ScriptKind.JSX`/`TSX` and a walk over the AST. It reads JSX, gives exact
`ImportDeclaration`, `ExportDeclaration`, `import()` and `require()` nodes, tells a string literal apart from a
computed specifier (reported as an unfollowable dynamic import), and returns parse diagnostics for the "could not be
parsed" report. Parsing 8000 files is a few seconds.

- _Alternative rejected — `ts.preProcessFile`:_ faster, but cannot tell a computed `import()` apart and gives no parse
  diagnostics.
- _Alternative rejected — `es-module-lexer`:_ no JSX, no `require()`.
- **`typescript` 6.0.3 becomes a runtime dependency.** TypeScript 7 is the Go-native compiler without the JS compiler
  API; 6.0.3 is already pinned for lint compatibility.

### 2. Resolve against an in-memory index, not the file system

One glob lists every project file under the target once (excluding `node_modules`, `build`, `.git`). Resolution is
then a pure function over that `Set`: probing `x`, `x.js`, `x.jsx`, `x.ts`, `x.tsx`, `x/index.*` is set lookups, not
`stat` calls — thousands of probes for 8000 files cost nothing, and the resolver is unit-testable without a disk.

`baseUrl` is read from `jsconfig.json`, else `tsconfig.json`, at the target root with
`ts.parseConfigFileTextToJson` (both allow comments). Only `baseUrl` is honoured.

### 3. Classification order

For a specifier: relative → resolve, else **unresolved**. Bare → try `baseUrl` if set, found → resolved; else
**package**. A resolved path is then **internal** if discovered, **asset** if its extension is not
`.js/.jsx/.ts/.tsx`, else **outside the set**. A missing stylesheet (`./x.css` not found) is **unresolved**, not an
asset: it is a broken import like any other. The asset check runs on the resolved file, so `import './theme'`
resolving to `theme.js` is code, not an asset.

### 4. Discovery with tinyglobby

`tinyglobby` (small, no dependencies, brace and globstar support via picomatch) for `source.include` with
`source.exclude` plus a fixed `**/node_modules/**` ignore. Paths are POSIX, relative to the target, sorted by code
unit order — independent of locale and platform.

- _Alternative rejected — `fs.promises.glob`:_ still flagged experimental on Node 22 and prints a warning.

### 5. Cycles with iterative Tarjan

Strongly connected components with more than one file are the cycles. Iterative, because a recursive walk over an
8000-file chain can exceed the stack. Each cycle's files are sorted; cycles are sorted by their first file.

### 6. Order comes from the real scheduler

`plan` builds the `Scheduler` from the graph (inserted in sorted order) and drains it marking every file `done`. The
printed order is therefore exactly what a run with one worker and no failures would do — no second ordering
implementation to drift.

### 7. Module layout

```
src/graph/discover.ts    source selection, project file index
src/graph/extract.ts     specifiers + unfollowable dynamic imports + parse errors per file
src/graph/resolve.ts     pure resolver over the index and baseUrl
src/graph/cycles.ts      Tarjan
src/graph/build.ts       ties them together → ImportGraph
src/plan.ts              order + statistics, text and JSON rendering
```

`ImportGraph` holds `files`, `edges: Map<file, file[]>`, `imports` per file with classification, `unresolved`,
`dynamic`, `parseErrors`, `cycles`.

### 8. Default exclude

`source.exclude` defaults to
`['**/*.test.{js,jsx}', '**/*.spec.{js,jsx}', '**/__tests__/**', '**/setupTests.js']`. A zod array default replaces,
it does not merge — which is the specified behaviour and the least surprising one.

## Risks / Trade-offs

- [A codebase that relies on an ejected webpack alias] → Those imports show up as unresolved in `plan`, which is the
  signal to add configurable aliases in a later change rather than guessing now.
- [Parse errors from syntax TypeScript does not accept, e.g. Flow annotations] → Reported per file; such files still
  enter the graph with the imports that were read. A Flow codebase would need its own change.
- [Case-insensitive file systems: `./card` resolving to `Card.jsx` on macOS but not in CI] → Resolution is exact-case
  against the index, matching Linux CI; the mismatch shows as unresolved, which is a real bug worth reporting.
- [Performance claim of 30 s] → Guarded by a test on a generated 8000-file target.

## Open Questions

None that change the approach.
