# Design

## Context

`js-to-ts` builds a per-file `Baseline` on attempt 0 (`src/steps/js-to-ts/step.ts`): it reads the original, decides
the typed path, fails early through `baseline.blocked` when an importer names the file with its extension, and
otherwise renames the test and the file. Retries reuse the stored baseline, so a blocked file fails every attempt
without a model call. Both new checks plug into that same mechanism. See proposal.md for why they are needed and
specs/js-to-ts-step/spec.md for what they must do.

## Goals / Non-Goals

**Goals:** detect the two pilot failures deterministically, before any model call, with a message a person can act on.

**Non-Goals:**

- Classifying every type error the model cannot fix. Only "does not exist / not accepted" errors on project symbols
  are caught; the rest still reach the model and its iteration limit, as today.
- Tolerating the errors instead (committing a `.tsx` that keeps them). See Decision 3.
- Not retrying blocked files. Blocked attempts are already cheap (no model call, no gates); the retry policy is the
  transaction's, not this step's.
- Choosing between a `.js` and an existing `.tsx`. That is the team's decision.

## Decisions

### 1. Existing typed path: check before any rename

On attempt 0, after computing `to` (and the test's `testTo`) and before either `rename`, the step checks both with
`exists()`. When any is taken, it sets `baseline.blocked` with every taken path, in the form
`src/X.tsx already exists; renaming src/X.js would overwrite it — decide which of the two is current first`. It checks
both paths before renaming either, so a taken file path is not reported after the test has already been renamed.

The importer check stays first: an extension-named import would block the file anyway, and its message is the older one.

Alternative: rename with `COPYFILE_EXCL`-style semantics and catch `EEXIST`. Rejected: `fs.rename` has no exclusive
flag, and a check-then-rename is fine because the worktree belongs to one worker.

### 2. Dependency check: compiler API over the target's tsconfig

A new module, `src/steps/js-to-ts/dependencies.ts`, exports
`missingOnDependencies(cwd, files): Promise<DependencyError[]>`, where
`DependencyError = { file, line, message, declaredIn }`.

- **Program.** `ts.findConfigFile(cwd)` + `ts.getParsedCommandLineOfConfigFile` give the target's options
  (`paths`, `baseUrl`, `jsx`, `strict`). There is no tsconfig in a JS-only target. In that case the check returns
  nothing, and the model runs as today. Root names are the two renamed files plus every `.d.ts` in the parsed
  `fileNames`. That covers global declarations such as `src/typings/*.d.ts` without parsing the whole project. The
  imports are then followed as usual. `noEmit: true`; diagnostics are requested only for the two files.
- **Codes.** A diagnostic qualifies when its code, or the code of any message in its chain, is one of these:
  - 2339: property does not exist on type;
  - 2551: the same, with a "did you mean" hint;
  - 2353: an object literal may only specify known properties;
  - 2554 or 2555: the argument count is wrong.

  The JSX case in the pilot is a 2322 whose chain holds a 2339. That is why the chain is walked.

- **Anchor symbol.** From the token at the diagnostic's start, walk up to the construct the error is about:
  - `PropertyAccessExpression`: the accessed expression;
  - JSX attribute or opening element: the tag name;
  - object literal passed as an argument, or `CallExpression` (for 2554 and 2555): the callee.

  `checker.getSymbolAtLocation` on it follows an alias through `getAliasedSymbol`. The symbol counts as a project
  dependency only when every one of its declarations is in a source file that is:
  - not one of the two files;
  - not a default library file (`program.isSourceFileDefaultLibrary`);
  - not from an external library (`program.isSourceFileFromExternalLibrary`, which covers `node_modules`).

  Anything the walk cannot anchor, such as a call result or an element access, is left to the model.

- **Wiring.** `run()` calls this check on attempt 0, after the renames and only when nothing else blocked. When it finds errors, it
  sets `baseline.blocked` to the list: `src/X.tsx:86 Property 'options' does not exist on type … (declared in
src/modules/Ui/ComboBox/ComboBox.tsx)`, then `type these first: <unique declaredIn files>`.

Why not the configured `typecheckCommand`: its text output says where the error is, not which symbol and which
declaration it is about. That attribution needs the checker. The tool itself is only used for the step's normal check.

Why the anchor must be a project file: a project dependency can be typed in the same run or by the team. A package's
or lib's types cannot be changed there, and the model can sometimes work around them legitimately. For example,
`as HTMLInputElement` on a DOM lookup is erased and allowed.

### 3. Block, don't tolerate

Tolerating the errors would mean letting the step finish with them. The original `.js` has no type errors at all,
because `checkJs` is off. The `tsc` gate (`newErrorsOnly`) would therefore report every one of them as new. The step
would have to feed them into the gate's baseline. That is a cross-cutting change to `quality-gates`, and it would
commit a `.tsx` that is known not to type-check. Blocking keeps the gates as they are and gives an ordering hint.

A model-side `cannot_type` tool was considered and rejected: its claim would not be checked, and the step's rule is
"checked, not trusted".

## Risks / Trade-offs

- **TypeScript versions.** The repo's `typescript` may differ from the target's. A diagnostic seen only in-process
  could block a file that the target's `tsc` accepts. → The check only looks at "does not exist" errors, which are
  stable across versions, and the failure message quotes the diagnostic, so a false block is visible.
- **Cost.** One program per JavaScript file, built from the two files, the global `.d.ts` files and their transitive
  imports. → It is measured on `ActionsDropdown.js` in the pilot task. The target is well under the `tsc` baseline
  run (~17 s). When the cost is too high, a program shared per worktree is the follow-up, not part of this change.
- **Missed cases.** A dependency problem that shows up as a type mismatch rather than a missing member still loops as
  before. → That is accepted and named in Non-Goals. The pilot's cases are both missing-member errors.
- **Casts are possible in theory.** `(ComboBox as unknown as X).lastProps` would be erased and pass the step. →
  Blocking is still correct: that cast would misstate the dependency's type instead of fixing it.

## Migration Plan

No config or state changes. Files that failed with `type errors remain` on a later run fail earlier, with the new
reason. Rollback is reverting the commit.

## Mocked modules (after pilot 2026-09-27)

The first pilot run on `master` blocked `ActionsDropdown.js` wrongly: its characterization test mocks
`@Modules/Navigation/_hooks` and calls `usePushRoute.mockReset()`. The declared hook type has no `mockReset`, but at
runtime the import is a `jest.fn`, and `(usePushRoute as jest.Mock).mockReset()` fixes it with types only. The same
holds for the mocked `ComboBox` and its `lastProps`.

- **Decision:** before judging a file, collect the modules it passes to `jest.mock`/`jest.doMock` (string literal
  first argument), resolved with `ts.resolveModuleName` and the tsconfig's options, so `@Modules/...` aliases, `index`
  files and extensions compare equal. An error whose anchor is an identifier imported (default, named or namespace)
  from one of those modules is left to the model.
- _Alternative:_ skipping errors whose missing member is a jest mock method (`mockReset`, `mockReturnValue`, …).
  Rejected: a mock factory can add any member (`ComboBox.lastProps`), and the name alone does not say the value is a
  mock.
