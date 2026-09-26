# Spec Delta

## ADDED Requirements

### Requirement: Source selection

The files to process SHALL be selected by `source.include` and `source.exclude` glob patterns, relative to the
target. By default `include` SHALL select JavaScript and JSX files under `src/`, and `exclude` SHALL leave out test
files (`*.test.*`, `*.spec.*`, anything under `__tests__/`) and the test setup file (`setupTests.js`), because a test
belongs to the file it tests rather than being a unit of work of its own. Setting `exclude` SHALL replace the
default list, not add to it.

#### Scenario: Default selection

- **WHEN** `source` is not configured and the target has `src/Card.jsx`, `src/Card.test.jsx`, `src/__tests__/api.js` and `src/setupTests.js`
- **THEN** only `src/Card.jsx` is selected

#### Scenario: Explicit exclude replaces the default

- **WHEN** `source.exclude` is set to `['src/legacy/**']`
- **THEN** files under `src/legacy/` are left out and test files are no longer excluded by default
