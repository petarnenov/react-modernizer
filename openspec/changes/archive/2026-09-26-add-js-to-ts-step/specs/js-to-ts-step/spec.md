# Spec Delta

## Purpose

Moves each file from JavaScript to TypeScript by adding types and nothing else — proven by comparing the program with
types erased against the original — so the codebase becomes typed without any change in what it does.

## ADDED Requirements

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

Before renaming, the step SHALL check the file's importers from the import graph. When any of them imports the file
with an explicit JavaScript extension, the attempt SHALL fail without a model call, naming each such importer and its
import.

#### Scenario: Explicit extension

- **WHEN** `src/Page.jsx` imports `./Card.jsx`
- **THEN** `src/Card.jsx` fails naming `src/Page.jsx` and `./Card.jsx`, and no model call is made

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
