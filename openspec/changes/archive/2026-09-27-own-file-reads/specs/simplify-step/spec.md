# Spec Delta

## MODIFIED Requirements

### Requirement: The step changes only the file

The step's model SHALL be able to read the file being simplified and its tests — its characterization test and its
colocated `<name>.test.*` file — write only the processed file, run only the configured tests and type check for it,
and report suspected bugs. Reading any other path SHALL be refused with a tool error that names the readable paths.
The model SHALL have no tool that lists directories. A change to any other file, tests included, SHALL fail the
attempt.

#### Scenario: Test edited

- **WHEN** after the step the file's characterization test differs from before
- **THEN** it is put back and the attempt fails naming it

#### Scenario: Other file refused

- **WHEN** the model reads `src/hooks/useCart.ts`, which `src/Cart.tsx` imports
- **THEN** it receives a tool error naming the paths it may read, and the step continues

## ADDED Requirements

### Requirement: Tests named in the prompt

The step's prompt SHALL name those of the file's tests that exist.

#### Scenario: Characterization test

- **WHEN** `src/Cart.tsx` has `src/Cart.characterization.test.tsx` and no colocated test
- **THEN** the prompt names `src/Cart.characterization.test.tsx`

#### Scenario: No tests

- **WHEN** the file has no test
- **THEN** the prompt says it has no tests
