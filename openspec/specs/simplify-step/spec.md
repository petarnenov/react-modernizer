# simplify-step Specification

## Purpose

Makes each file smaller and clearer after it has been converted and typed, without changing what it does or what it
exposes, and only when the result is measurably simpler.

## Requirements

### Requirement: Which files are simplified

The step SHALL measure a file's code lines — lines of code with comments and formatting ignored — and SHALL pass a
file with fewer than `steps.simplify.minLines` of them without any model call.

#### Scenario: Small file

- **WHEN** a file has 25 code lines and `minLines` is 40
- **THEN** the step makes no model call and the file is unchanged

#### Scenario: Large file

- **WHEN** a file has 120 code lines
- **THEN** the step asks the model to simplify it

### Requirement: The step changes only the file

The step's model SHALL be able to read files inside the target, write only the processed file, run only the
configured tests and type check for it, and report suspected bugs. A change to any other file, tests included, SHALL
fail the attempt.

#### Scenario: Test edited

- **WHEN** after the step the file's characterization test differs from before
- **THEN** it is put back and the attempt fails naming it

### Requirement: Same public surface

Every name the file exports before the step, value or type, SHALL be exported after it, and no export SHALL be added.

#### Scenario: Export removed

- **WHEN** the model removes `export type CardProps` because the file no longer needs it
- **THEN** the attempt fails naming `CardProps` as missing

### Requirement: Measurably simpler

The step SHALL measure code lines and complexity — branches (`if`, `?:`, `case`, loops, `catch`, `&&`, `||`, `??`)
plus the deepest nesting of functions and blocks — before and after, with comments and formatting ignored. An
unchanged file SHALL pass. A changed file SHALL pass only when neither measure increased and at least one decreased;
otherwise the attempt SHALL fail stating both measures before and after.

#### Scenario: Smaller and simpler

- **WHEN** the model replaces an effect that syncs derived state with a value computed during render, going from 120 to 96 code lines and complexity 18 to 15
- **THEN** the change is accepted

#### Scenario: Longer

- **WHEN** the model splits the file into many small helpers and code lines grow from 120 to 140
- **THEN** the attempt fails stating 120 → 140 lines

#### Scenario: Nothing to simplify

- **WHEN** the model decides the file is already simple and leaves it unchanged
- **THEN** the file passes

### Requirement: Simplification rules

The step's instructions SHALL require identical behaviour and SHALL direct the model toward: computing derived values
during render instead of syncing them into state with effects; removing effects that are not needed; early returns
instead of deep nesting; one mapped list instead of repeated JSX; removing unused variables, imports and private
helpers; and clearer names for private identifiers. They SHALL forbid removing `useMemo`, `useCallback` or `memo`,
adding dependencies, changing libraries or state management, renaming or removing exports, and fixing bugs, which are
to be reported.

#### Scenario: Instructions

- **WHEN** the step builds its instructions
- **THEN** they state each of these directions and prohibitions
