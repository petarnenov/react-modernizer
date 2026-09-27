# js-to-ts-step Specification

## Purpose

Moves each file from JavaScript to TypeScript by adding types and nothing else — proven by comparing the program with
types erased against the original — so the codebase becomes typed without any change in what it does.

## Requirements

### Requirement: What is renamed

For a JavaScript file `<Name>.js` or `<Name>.jsx`, the step SHALL rename it to `<Name>.tsx` when it contains JSX and
to `<Name>.ts` otherwise, and SHALL rename its characterization test file by the same rule, according to whether
the test file contains JSX. The step SHALL change no
other file. A file that is already TypeScript SHALL pass the step with no model call.

#### Scenario: Component

- **WHEN** the step processes `src/Card.jsx` with `src/Card.characterization.test.jsx`
- **THEN** they become `src/Card.tsx` and `src/Card.characterization.test.tsx`

#### Scenario: Plain module

- **WHEN** the step processes `src/format.js`, which contains no JSX
- **THEN** it becomes `src/format.ts`

### Requirement: Importers that would break

Before renaming, the step SHALL check the file's importers: every code file under the project's source roots that
imports it, whether or not that file is part of the run. When any of them imports the file with an explicit
JavaScript extension, the attempt SHALL fail without a model call, naming each such importer and its import.

#### Scenario: Explicit extension

- **WHEN** `src/Page.jsx` imports `./Card.jsx`
- **THEN** `src/Card.jsx` fails naming `src/Page.jsx` and `./Card.jsx`, and no model call is made

#### Scenario: Importer outside the run

- **WHEN** only `src/Card.jsx` is included and `src/Page.tsx`, not included, imports `./Card.jsx`
- **THEN** `src/Card.jsx` fails naming `src/Page.tsx`

### Requirement: Types only

After the model finishes, the step SHALL compile the file and its test file to JavaScript with types erased, keeping
every import, and SHALL compare the result with the original JavaScript, ignoring formatting and comments. Any
difference SHALL fail the attempt, naming the first differing lines of each file. Type annotations, type-only imports,
interfaces, type aliases, generics and `as` assertions are erased and therefore allowed; anything that changes the
emitted JavaScript, including `enum`, is not.

#### Scenario: Only annotations added

- **WHEN** the model adds a props interface, parameter types and `useState<string>`
- **THEN** the comparison passes

#### Scenario: Guard added to satisfy the compiler

- **WHEN** the model adds `if (!user) return null;` to make a strict null check pass
- **THEN** the attempt fails naming that line as a difference

#### Scenario: Enum

- **WHEN** the model replaces string constants with an `enum`
- **THEN** the attempt fails, because an enum emits JavaScript

### Requirement: Same runtime exports

The set of value exports SHALL be the same before and after. Exported types and interfaces MAY be added.

#### Scenario: Exported props type

- **WHEN** the model adds `export interface CardProps`
- **THEN** the attempt passes this check

### Requirement: Type-checked

The step's model SHALL be able to run the configured type check and receive the errors reported for the file and its
test file. The step SHALL fail the attempt when the type check reports errors in either file.

#### Scenario: Remaining type error

- **WHEN** after the model the type check reports an error in `src/Card.tsx`
- **THEN** the attempt fails with that error, and the retry receives it

### Requirement: Typing rules

The step's instructions SHALL require strict, explicit types: props described by an interface or type named after the
component; no `any` (use `unknown` and narrowing, or a precise type); no `@ts-ignore`, `@ts-expect-error` or
`@ts-nocheck`; no non-null assertions to silence the compiler; typed event handlers, state, refs and reducers; `import
type` for type-only imports; union types instead of `enum`; the configured type helpers (such as typed Redux hooks)
used instead of re-declaring types; and no change to the code itself.

#### Scenario: Instructions

- **WHEN** the step builds its instructions
- **THEN** they state each of these rules

### Requirement: Fitting the importers

The model SHALL be given the paths of the file's importers (at most 20, then how many more), and SHALL be told that
it can change only its own two files; that type errors reported in other files mean its types do not fit how those
files use the module; that it must widen or adjust its own types to fit them; and that it should read only the lines
around each reported error.

#### Scenario: Importers listed

- **WHEN** `src/Card.jsx` is imported by `src/Page.tsx` and `src/List.tsx`
- **THEN** the prompt names both files and states how to react to errors in them

#### Scenario: Many importers

- **WHEN** 45 files import the file
- **THEN** the prompt names 20 of them and says there are 25 more

### Requirement: Tests the step runs

The step's `run_tests` tool SHALL run the configured `testCommand` with `{testFile}` replaced by the file's
characterization test after renaming and `{file}` by the renamed file. When the file has no characterization test and
the command refers to `{testFile}`, the tool SHALL run nothing and tell the model there is no test to run.

#### Scenario: Own test only

- **WHEN** `src/Card.jsx` became `src/Card.tsx` and its test `src/Card.characterization.test.tsx`
- **THEN** `run_tests` runs `{testRunner} src/Card.characterization.test.tsx` and no test of any importer

#### Scenario: No test

- **WHEN** `src/format.js` has no characterization test
- **THEN** `run_tests` runs nothing and says there is no test for this file

### Requirement: Typed path already taken

Before renaming, the step SHALL check whether the typed path of the file, or of its characterization test, already
exists. When one does, the attempt SHALL fail without a model call, naming each existing file and the file it would
replace it with, and the step SHALL rename, overwrite or delete nothing.

#### Scenario: Both files tracked

- **WHEN** the step processes `src/Dropdown.js`, which contains JSX, and `src/Dropdown.tsx` already exists
- **THEN** the attempt fails naming `src/Dropdown.tsx`, no model call is made, and both files are unchanged

#### Scenario: Test already typed

- **WHEN** `src/format.js` is processed, `src/format.ts` does not exist, and both
  `src/format.characterization.test.js` and `src/format.characterization.test.ts` exist
- **THEN** the attempt fails naming `src/format.characterization.test.ts`, and nothing is renamed

### Requirement: Missing members on dependencies

After renaming and before the model call, the step SHALL type-check the renamed file and its renamed test file,
unchanged, with the target's TypeScript configuration. The attempt SHALL fail without a model call when either file
has an error stating that something does not exist on, or is not accepted by, the declared type of a symbol that is
declared in another file of the project. These errors are a property that does not exist on the type, a JSX
attribute that does not exist on a component's props, an object-literal property the parameter type does not
declare, and a number of arguments the function's declared parameters do not allow. The symbol is the value accessed, the JSX component, or the
function called. The failure SHALL name each such error with its file and line, and the declaring file of the
symbol, and SHALL say to type that file first. Other type errors, and errors on symbols declared in packages or
TypeScript's own libraries, SHALL NOT fail the attempt here; they are left to the model. Neither SHALL errors on a
symbol the file imports from a module that the same file replaces with `jest.mock` or `jest.doMock`: at runtime it
is a mock, and a type assertion in the file fixes the error.

#### Scenario: Component without props type

- **WHEN** `src/Dropdown.js` renders `<ComboBox options={OPTIONS} />` and `src/ui/ComboBox.tsx` declares
  `class ComboBox extends Component` without a props type
- **THEN** the attempt fails without a model call, naming the error on `options` at its line in `src/Dropdown.tsx` and
  `src/ui/ComboBox.tsx` as the file to type first

#### Scenario: Property missing on an imported value in the test

- **WHEN** the renamed characterization test reads `ComboBox.lastProps`, does not mock `src/ui/ComboBox.tsx`, and the
  class declared there has no `lastProps`
- **THEN** the attempt fails without a model call, naming that error and `src/ui/ComboBox.tsx`

#### Scenario: Type mismatch left to the model

- **WHEN** the only type error is that a local `const kind = 'card'` is passed where an imported function declares
  the parameter `'card' | 'list'`
- **THEN** the model is called as usual

#### Scenario: Local symbol

- **WHEN** the file reads a property that does not exist on an object literal declared in the file itself
- **THEN** the model is called as usual

#### Scenario: Package type

- **WHEN** the missing property is on a type declared in a package under `node_modules`
- **THEN** the model is called as usual

#### Scenario: Mocked module

- **WHEN** the renamed characterization test calls `jest.mock('@Modules/Navigation/_hooks', …)`, imports
  `usePushRoute` from `@Modules/Navigation/_hooks`, and calls `usePushRoute.mockReset()`, which the hook's declared
  type does not have
- **THEN** the model is called as usual
