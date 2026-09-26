# Tasks

## 1. Dependencies and configuration

- [ ] 1.1 Move `typescript` 6.0.3 to `dependencies`, add `tinyglobby` 0.2.17, and record both in DECISIONS.md;
      verify `npm ci` and `npm run build` succeed
- [ ] 1.2 Set the default `source.exclude` to the test patterns in design §8; verify config tests for "Default
      selection" (defaults present) and "Explicit exclude replaces the default"

## 2. Fixture

- [ ] 2.1 Add `test/fixtures/cra-app/` with `jsconfig.json` (`baseUrl: src`), relative, extensionless, index and
      absolute imports, a CSS module, an image, a `.ts` file, a test file, `setupTests.js`, a two-file cycle, a
      broken import, a computed `import()`, a file that does not parse, and a `node_modules/` directory; verify the
      tree matches the scenarios listed in specs/import-graph

## 3. Graph

- [ ] 3.1 `discover.ts`: source selection and project file index with tinyglobby, sorted, `node_modules` ignored;
      verify tests for "Stable result", "Dependencies are not project files" and the default selection on the fixture
- [ ] 3.2 `extract.ts`: specifiers from all import forms via `ts.createSourceFile`, unfollowable dynamic imports and
      parse errors; verify tests for "All import forms", "Computed specifier" and a JSX file
- [ ] 3.3 `resolve.ts`: pure resolver over the index and `baseUrl` (from `jsconfig.json`, else `tsconfig.json`, with
      comments allowed) plus classification; verify tests for every resolution and classification scenario
- [ ] 3.4 `cycles.ts`: iterative Tarjan returning sorted groups of two or more files; verify tests for "Indirect
      cycle", "No cycles", a self-import, and a 10 000-file chain without stack overflow
- [ ] 3.5 `build.ts`: combine into `ImportGraph`; verify an end-to-end test on the fixture asserting edges,
      classifications, unresolved, dynamic, parse errors and cycles

## 4. Plan command

- [ ] 4.1 `plan.ts`: order by draining the real `Scheduler`, statistics, text and JSON rendering with paths relative
      to the target; verify tests for "Order follows dependencies" and "Codebase with problems"
- [ ] 4.2 `plan [config] [--json]` in the CLI with exit codes as specified; verify tests for "JSON output", "Problems
      are not failures" and "Missing target", and that the fixture tree is byte-identical before and after (`Target
    is not changed`)

## 5. Scale and docs

- [ ] 5.1 Performance test generating an 8000-file target in a temp directory; verify the graph builds within 30 s
- [ ] 5.2 Update README usage and the status table in docs/design.md; verify links and commands by running them
- [ ] 5.3 Run `npm run verify`; verify it passes
