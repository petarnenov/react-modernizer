# Design

## Context

All five steps get `readTools(cwd)` from `src/steps/shared/tools.ts`: `read_file` and `list_directory`, confined to
the target by `confine`. `analyze` already works out its tests (`existingTestPath`, `characterizationTestPath`) and
names them in the prompt, along with its importers. `simplify` names no tests; its instructions say "Read the file
and its tests", so the model finds them by listing.

## Goals / Non-Goals

**Goals:**

- One read tool, limited to a fixed list of paths, shared by `analyze` and `simplify`.

**Non-Goals:**

- No change to the other three steps or to `confine`.
- No change to the Ollama history compaction. It keys on the `read_file` tool name and path, and both stay the same.

## Decisions

- **`readOwnFilesTool(cwd, paths)` in `shared/tools.ts`, named `read_file`.** It keeps the tool name, so progress output
  and Ollama compaction do not change. The path goes through `confine` first, so the same refusals as before apply
  (absolute paths, `..`, links out). The result is then made relative to `cwd` and compared with `paths`. That way
  `./src/Card.jsx` and `src/Card.jsx` match. A miss throws `only these files can be read: <paths>`. The description
  names the paths.
  - _Alternative:_ a `filter` option on `readTools`. Rejected: `list_directory` has to go anyway, so a second
    function is clearer than a flag.
- **Which paths are "its tests".** The characterization test `characterizationTestPath(file)`, plus the colocated
  test `<dir>/<name>.test.{js,jsx,ts,tsx}`. `simplify` runs after `js-to-ts`, so the file is `Card.tsx` while the
  user's own `Card.test.js` keeps its extension. One helper, `ownTestCandidates(file)`, next to the existing path
  helpers in `characterize-tests/paths.ts`. The tool allows every candidate. The prompt names only those that exist.
- **`analyze` prompt.** The importers line is removed, and `PromptInput.importers` goes with it. `ctx.importers`
  stays on `StepContext`, because `js-to-ts` uses it.
- **`simplify` prompt.** It gets `tests: readonly string[]`: `Its tests: …`, or `It has no tests.`

## Risks / Trade-offs

- [`analyze` misses a bug that only shows in how importers call the file] → That is the price of the narrower
  context. The finding would be speculative about code the step does not own. `js-to-ts` still sees importers
  through `tsc`.
- [`simplify` cannot read an imported hook to confirm it is stable] → Its instructions already forbid removing
  memoisation and changing state management. The tests and the type check gate the result.
