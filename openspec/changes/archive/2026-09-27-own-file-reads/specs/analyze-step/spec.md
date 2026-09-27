# Spec Delta

## MODIFIED Requirements

### Requirement: Analysis changes nothing

The step's model SHALL be able to read the file being analysed and its tests — its characterization test and its
colocated `<name>.test.*` file — and report findings. Reading any other path SHALL be refused with a tool error that
names the readable paths. The model SHALL have no tool that lists directories, writes or runs anything. Any change to
any file during the step SHALL fail the attempt and be put back.

#### Scenario: Read-only

- **WHEN** the step runs on `src/Cart.jsx`
- **THEN** the model's tools are reading and reporting only, and the file is unchanged afterwards

#### Scenario: Own file and tests

- **WHEN** the model reads `src/Cart.jsx`, `src/Cart.characterization.test.jsx` or `src/Cart.test.js`
- **THEN** it receives the content of that file

#### Scenario: Importer refused

- **WHEN** the model reads `src/Checkout.tsx`, which imports `src/Cart.jsx`
- **THEN** it receives a tool error naming the paths it may read, and the step continues

## ADDED Requirements

### Requirement: What the prompt names

The step's prompt SHALL name the file and those of its tests that exist. It SHALL NOT name the file's importers or
direct the model to read other files.

#### Scenario: Imported file

- **WHEN** `src/format.js` is imported by `src/Price.tsx` and `src/Total.tsx`
- **THEN** the prompt names `src/format.js` and neither importer
