## ADDED Requirements

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
