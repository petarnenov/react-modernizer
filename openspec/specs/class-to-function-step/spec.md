# class-to-function-step Specification

## Purpose

Turns class components into function components with hooks, file by file, without changing what they do — proven
by tests the step cannot touch — and without breaking any file that imports them.

## Requirements

### Requirement: Which files are converted

A file SHALL be converted when it contains a class that extends `React.Component`, `React.PureComponent`,
`Component` or `PureComponent`. Classes of a kind listed in `steps.class-to-function.skip` SHALL be left as classes;
`error-boundary` covers classes that define `componentDidCatch` or a static `getDerivedStateFromError`. A file with no
class to convert SHALL pass the step without any model call.

#### Scenario: Function components only

- **WHEN** the file contains no class component
- **THEN** the step makes no model call and the file is unchanged

#### Scenario: Error boundary

- **WHEN** the file's only class defines `componentDidCatch`
- **THEN** the class stays, no model call is made, and the file passes the step

#### Scenario: Class component

- **WHEN** the file contains `class Card extends React.Component`
- **THEN** the step converts it

### Requirement: The step changes only the file

The step's model SHALL be able to read files inside the target, list directories, write only the processed file,
run only the configured test command for it, and report suspected bugs. It SHALL NOT be able to change tests or any
other file; a change to anything but the processed file SHALL fail the attempt. The file SHALL keep its path and
language.

#### Scenario: Attempt to edit a test

- **WHEN** after the step `Card.characterization.test.jsx` differs from before
- **THEN** it is put back and the attempt fails naming it

### Requirement: What counts as converted

After the model finishes, the file SHALL be parsed again. The attempt SHALL fail when a class component that should
have been converted remains, naming it, or when the set of names the file exports differs from before, naming the
missing and added exports. The file's characterization tests and existing related tests SHALL pass without change.

#### Scenario: Class left behind

- **WHEN** the model converts `Card` but leaves `class Header extends Component` in the same file
- **THEN** the attempt fails naming `Header`, and the retry receives that reason

#### Scenario: Export renamed

- **WHEN** the file exported `default` and `CardProps` before and exports `default` and `Props` after
- **THEN** the attempt fails naming `CardProps` as missing and `Props` as added

### Requirement: Conversion rules

The step's instructions SHALL require the converted components to behave identically: same props and defaults, same
rendered output, same side effects in the same order, same public exports; lifecycle methods mapped to effects with
correct dependencies and cleanup; `setState` semantics kept, including functional updates and merged state; instance
fields that must survive renders kept in refs; `shouldComponentUpdate` and `PureComponent` expressed with `React.memo`;
instance methods used through refs by parents exposed with `forwardRef` and `useImperativeHandle`; higher-order
wrappers such as `connect` left as they are; and the file kept in JavaScript. Suspected bugs SHALL be reported, not
fixed.

#### Scenario: Instructions

- **WHEN** the step builds its instructions
- **THEN** they state each of these rules
