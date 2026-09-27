# Proposal

## Why

Pilot `pilot-two.yaml` (2026-09-27, `glm-5.3`) showed two ways `js-to-ts` wastes a whole file budget, or does damage,
on a file it can never finish:

- **A dependency declares no such member.** In `ActionsDropdown.js` every `<ComboBox options=… />` fails with TS2322,
  "Property 'options' does not exist on type `IntrinsicAttributes & … & Readonly<{}>`", because `ComboBox.tsx` is
  `class ComboBox extends Component` with no props type. The test fails in the same way on `ComboBox.lastProps` (TS2339). The model may write only its
  own two files, may not use `any` or `@ts-ignore`, and may not change the code. So no types-only edit can remove
  the error. The model spent 38+ turns listing `src/Modules/Ui/ComboBox` and neighbouring components over and over. Next it
  would reach the 50-iteration limit, fail with `type errors remain`, and do the same for three more retries.
- **The typed path already exists.** The target tracks both `ActionsDropdown.js` and `ActionsDropdown.tsx`, left by
  the team's own partial migration. The step renames `.js` → `.tsx` with `fs.rename`, which silently replaces the
  existing file. Here the two were identical. With a hand-typed `.tsx`, the team's work would be lost and the model
  would retype a file that was already typed.

Both cases can be detected before any model call, and both need a person, not the model: type the dependency first, or
decide which of the two files is the real one.

## What Changes

- **The typed path must be free.** Before renaming, the step fails the attempt without a model call when the typed
  path of the file, or of its characterization test, already exists. The failure names the existing file. Nothing is
  renamed or overwritten.
- **Missing members on a dependency block the file.** After renaming and before the model call, the step
  type-checks the untouched typed file and its test with the TypeScript compiler API. The check uses the target's
  `tsconfig.json`. The file is blocked when it has "does not exist" errors on a symbol declared in another file of
  the project. These are missing properties, missing JSX props, and argument counts the function does not allow. The attempt then fails without a
  model call. The failure names each error with its line and the dependency file whose types lack the member. The
  failure tells the user to type that dependency first. Type mismatches (for example a literal widened to `string`) are
  still the model's job; they can be fixed with annotations or `as const`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `js-to-ts-step`: two new failure conditions checked before the model is called: an existing typed path, and missing
  members on project dependencies.

## Impact

- `src/steps/js-to-ts/step.ts` (both checks in the attempt-0 baseline), a new `src/steps/js-to-ts/dependencies.ts`
  (compiler-API check), `test/js-to-ts.test.ts` with fixtures.
- One extra in-process type check per JavaScript file before its first model call. It creates a program from the
  target's `tsconfig.json` and gets diagnostics for the two files only. There is no model cost. No config options and no dependency changes.
- Files that use an untyped project component now fail fast with an actionable reason instead of burning their budget.
  They pass once the dependency is typed, which is the order the import graph already suggests.
