# analyze-step Specification

## Purpose

Reads each file before anything changes it and reports the bugs and risks a person should know about — without
changing a line.

## Requirements

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

### Requirement: Grounded findings

Before the model is called, the step SHALL run the configured lint command for the file and give its output to the
model as evidence to confirm or dismiss. A lint command that fails to run SHALL NOT fail the step; the model SHALL be
told that no lint evidence is available.

#### Scenario: Lint warning

- **WHEN** ESLint reports `react-hooks/exhaustive-deps` on line 14 of the file
- **THEN** the model's prompt contains that warning

#### Scenario: No linter

- **WHEN** the lint command cannot run in the target
- **THEN** the step still analyses the file, and the prompt says there is no lint evidence

### Requirement: Findings

The model SHALL report each finding with a line, a severity of `high` (wrong behaviour users can hit, data loss,
security), `medium` (wrong under specific conditions, races, leaks) or `low` (fragile code a later refactor could
break), and a reason. Each finding SHALL be recorded against the file with the step `analyze`. A file with no findings
SHALL pass.

#### Scenario: Stale closure

- **WHEN** a `setInterval` callback in `src/Timer.jsx` reads state captured when the effect first ran
- **THEN** a finding is recorded for `src/Timer.jsx` with its line, a severity and the reason

#### Scenario: Clean file

- **WHEN** the model finds nothing
- **THEN** the file passes the step with no findings

### Requirement: What to look for

The step's instructions SHALL direct the model to: logic errors and wrong conditions; stale closures and missing or
wrong effect dependencies; missing effect cleanup (timers, subscriptions, listeners); race conditions in asynchronous
code and state updates after unmount; mutation of props or state; wrong or missing `key` props; unhandled promise
rejections and errors; accessibility problems a user would hit; and code that relies on class-component behaviour
the later conversion will not keep. They SHALL require reporting only what the model can point to in the code, and
forbid style remarks and changes.

#### Scenario: Instructions

- **WHEN** the step builds its instructions
- **THEN** they state each of these directions and restrictions

### Requirement: Size filter

A file with fewer code lines than `steps.analyze.minLines` SHALL pass without any model call.

#### Scenario: Small file skipped

- **WHEN** `minLines` is 30 and a file has 12 code lines
- **THEN** the step makes no model call for it

### Requirement: What the prompt names

The step's prompt SHALL name the file and those of its tests that exist. It SHALL NOT name the file's importers or
direct the model to read other files.

#### Scenario: Imported file

- **WHEN** `src/format.js` is imported by `src/Price.tsx` and `src/Total.tsx`
- **THEN** the prompt names `src/format.js` and neither importer
