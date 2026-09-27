# Tasks

## 1. Typed path already taken

- [x] 1.1 In `createJsToTsStep` attempt 0, after the importer check and before any `rename`, check the typed path of
      the file and of its characterization test; when any exists, set `baseline.blocked` naming each existing path and the
      file it would replace. Verify with tests in `test/js-to-ts.test.ts`: `Dropdown.js` + existing `Dropdown.tsx` fails
      with that path, the model stub is never called, and both files keep their content; an existing typed test file blocks
      with the file itself not renamed.

## 2. Missing members on dependencies

- [x] 2.1 Add `src/steps/js-to-ts/dependencies.ts` with `missingOnDependencies(cwd, files)`. It loads the target's
      tsconfig and builds the program from the two files plus the tsconfig's `.d.ts` files. It keeps diagnostics whose
      chain holds 2339, 2551, 2353, 2554 or 2555. It resolves the anchor symbol (the property access expression, the JSX
      tag, or the call callee, following aliases) and keeps it only when every declaration is in another project source
      file. It returns nothing when there is no tsconfig. Verify with unit tests on small temp projects:
  - a class component without a props type used with a prop → one error declared in the component file;
  - `Imported.missing` → blocked;
  - a literal-to-union mismatch → nothing;
  - a missing property on a local object → nothing;
  - a missing property on a `node_modules` type → nothing;
  - no tsconfig → nothing.
- [x] 2.2 Call it in `run()` on attempt 0, after the renames, only when nothing else blocked. Set `baseline.blocked`
      to the errors (`file:line message (declared in …)`) and a `type these first:` line with the unique declaring files.
      Verify with a `js-to-ts` test in which the model stub is never called and the thrown reason names the dependency.
      Verify also that a retry (attempt 1) fails with the same reason and makes no model call.

- [x] 2.3 Leave errors on symbols imported from a module the same file mocks (`jest.mock`/`jest.doMock`, resolved with
      the tsconfig's options) to the model. Verify with unit tests: a test that mocks `./hooks` through an alias and calls
      `usePushRoute.mockReset()` → nothing; the same call without the `jest.mock` → blocked; a mocked default-imported
      component read as `ComboBox.lastProps` → nothing.

## 3. Docs and verification

- [x] 3.1 README and docs/design.md: the `js-to-ts` section lists both early failures and what to do about them.
      Verify by reading the rendered sections.
- [x] 3.2 `npm run verify` green (typecheck, lint, test, specs, build).
- [x] 3.3 Pilot on `master` (via its `-modernized` branch) with the file the first pilot blocked wrongly:
      `./modernize pilot-one-all.yaml --files src/pages/ComplianceCenter/subPages/ClientAccountRisk/subPages/_components/ActionsDropdown/ActionsDropdown.js`.
      It must not fail with a blocked reason naming a mocked module (`usePushRoute`, `ComboBox.lastProps` in the test).
      A block on `ComboBox` props in `ActionsDropdown.tsx` itself is correct. The typed-path case has no instance on
      `master` and is covered by the step tests.
