# configuration Specification

## Purpose

Defines how a run is configured: one YAML file validated in full before any work starts, with safe defaults for
everything but the target, and command-line overrides that obey the same limits as the file.

## Requirements

### Requirement: Validated configuration file

The tool SHALL read its configuration from a YAML file and validate all of it before doing any work. `target` SHALL
be the only required setting; every other setting SHALL have a default. Unknown keys and out-of-range values SHALL
be rejected, and the error SHALL name every offending setting by its path and the file it was read from. An option
that the tool used to accept and has removed SHALL be reported with a hint saying it was removed and what to do. A
relative `target` SHALL resolve against the directory of the configuration file, not the current directory.

#### Scenario: Minimal configuration

- **WHEN** the file contains only `target`
- **THEN** it is accepted and every other setting takes its default

#### Scenario: Invalid value

- **WHEN** the file sets `concurrency.workers: 0`
- **THEN** it is rejected with an error naming `concurrency.workers`, and no work starts

#### Scenario: Unknown key

- **WHEN** the file contains a key the tool does not know, at any level
- **THEN** it is rejected with an error naming that key

#### Scenario: Relative target

- **WHEN** a configuration file in `/work/cfg/` sets `target: ./app`
- **THEN** the target is `/work/cfg/app`, wherever the tool is run from

#### Scenario: Missing file

- **WHEN** the configuration file does not exist or cannot be read
- **THEN** the tool reports a configuration error with the path and exits non-zero

#### Scenario: Error names the file

- **WHEN** `/work/modernizer.config.yaml` has an invalid value
- **THEN** the error message includes `/work/modernizer.config.yaml`

#### Scenario: Removed option

- **WHEN** the file sets `steps.js-to-ts.codemod: ts-migrate`
- **THEN** the error names `steps.js-to-ts.codemod`, says the option was removed, and says to delete the line

### Requirement: Pipeline steps are switchable

The configuration SHALL list the per-file steps — analyze, characterize-tests, class-to-function,
redux-connect-to-hooks, js-to-ts, simplify — each of which can be enabled or disabled. All steps SHALL be enabled
by default except redux-connect-to-hooks, which SHALL be disabled by default. Error boundaries SHALL be skipped by
class-to-function by default.

#### Scenario: Default steps

- **WHEN** no steps are configured
- **THEN** analyze, characterize-tests, class-to-function, js-to-ts and simplify are enabled, and redux-connect-to-hooks is not

#### Scenario: Unknown step

- **WHEN** the file configures a step that does not exist
- **THEN** it is rejected with an error naming that step

### Requirement: Concurrency defaults to one worker

The number of files processed at once SHALL default to one. It SHALL be settable in the file and overridable on the
command line, and an override SHALL be validated by the same rules as the file. The number of concurrent gate runs
SHALL default to the number of workers and follow an override of it, unless the file sets it to a different value.

#### Scenario: Default

- **WHEN** concurrency is not configured
- **THEN** one worker and one gate run at a time

#### Scenario: Command-line override

- **WHEN** the file sets no concurrency and the command line passes `--workers 4`
- **THEN** four workers and four gate runs at a time

#### Scenario: Gates set apart are kept

- **WHEN** the file sets two workers and one gate run, and the command line passes `--workers 8`
- **THEN** eight workers and one gate run at a time

#### Scenario: Invalid override

- **WHEN** the command line passes `--workers 0`
- **THEN** the tool rejects it and no work starts

### Requirement: Configuration can be checked without running

The tool SHALL offer a command that validates a configuration file, with any command-line overrides, and prints the
resulting configuration with every default filled in, without touching the target codebase.

#### Scenario: Checking a valid file

- **WHEN** `check-config` is run on a valid file
- **THEN** it prints the full configuration, summarises workers and enabled steps, and exits zero

#### Scenario: Checking an invalid file

- **WHEN** `check-config` is run on an invalid file
- **THEN** it prints what is wrong and exits non-zero

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

### Requirement: Run branch and gate timeout

The configuration SHALL name the branch accepted files are committed to (`git.branch`, default `modernizer/run`)
and the commit it starts from when it does not exist yet (`git.base`, default `HEAD`). It SHALL set how long one
gate command may run (`gates.timeoutSeconds`, default 600, at least 1).

#### Scenario: Defaults

- **WHEN** `git` and `gates.timeoutSeconds` are not configured
- **THEN** the run branch is `modernizer/run`, it starts from `HEAD`, and a gate command may run for 600 seconds

#### Scenario: Invalid timeout

- **WHEN** `gates.timeoutSeconds` is 0
- **THEN** the configuration is rejected with an error naming `gates.timeoutSeconds`

### Requirement: Model and step options

The configuration SHALL set the model used by model steps (`model.default`, default `claude-sonnet-5`), the reasoning
effort (`model.effort`, one of `low`, `medium`, `high`, `xhigh`, `max`, default `high`), and per step an optional
`model` override. The `characterize-tests` step SHALL accept `testCommand` (default `{testRunner} {testFile}`), the
command its model runs to execute the tests, and `helpers`, a list of test helper files for the model to use.

#### Scenario: Defaults

- **WHEN** `model` and the step's options are not configured
- **THEN** model steps use `claude-sonnet-5` at effort `high`, and `characterize-tests` runs `{testRunner} {testFile}` with no helpers

#### Scenario: Per-step model

- **WHEN** `steps.characterize-tests.model` is `claude-opus-5`
- **THEN** that step uses `claude-opus-5` while other model steps use `model.default`

#### Scenario: Invalid effort

- **WHEN** `model.effort` is `extreme`
- **THEN** the configuration is rejected with an error naming `model.effort`

### Requirement: One test runner

The configuration SHALL name the command that runs the target's tests once, as `testRunner` (default
`CI=true npx react-scripts test --watchAll=false`, which is how a Create React App project runs Jest). Every command
that runs tests — gate commands, the `characterize-tests` test command and the coverage gate — SHALL be able to refer
to it as `{testRunner}`, and the default commands SHALL do so. `gates.coverage.min` SHALL accept 0 to turn the
coverage gate off.

#### Scenario: Create React App by default

- **WHEN** `testRunner` is not configured
- **THEN** the default test gate runs `CI=true npx react-scripts test --watchAll=false --findRelatedTests` with the changed files

#### Scenario: Project that runs Jest directly

- **WHEN** `testRunner` is `npx jest --ci`
- **THEN** the test gate, the step's test command and the coverage gate all run `npx jest --ci`

#### Scenario: Coverage off

- **WHEN** `gates.coverage.min` is 0
- **THEN** no coverage is measured

### Requirement: Class-to-function options

The `class-to-function` step SHALL accept `testCommand` (default `{testRunner} --findRelatedTests {file}`), the
command its model runs to execute the tests related to the file, and `requireTests` (default true). When
`class-to-function` is enabled, `requireTests` is true and `characterize-tests` is disabled, the run SHALL refuse to
start and say why.

#### Scenario: Converting without tests

- **WHEN** `class-to-function` is enabled and `characterize-tests` is disabled
- **THEN** the run refuses to start, naming both steps and `steps.class-to-function.requireTests`

#### Scenario: Explicit opt-out

- **WHEN** the same configuration sets `steps.class-to-function.requireTests: false`
- **THEN** the run starts

### Requirement: JS-to-TS options

The `js-to-ts` step SHALL accept `typecheckCommand` (default `npx tsc --noEmit --incremental`), `testCommand` (default
`{testRunner} --findRelatedTests {file}`) and `helpers`, a list of files with shared types for the model to use (for
example typed Redux hooks). It SHALL NOT accept `codemod`. `gates.forbid` SHALL include `@ts-expect-error` by default,
alongside `: any`, `as any`, `@ts-ignore` and `@ts-nocheck`. When `js-to-ts` is enabled and the target has no
`tsconfig.json`, the run SHALL refuse to start and say that the project needs a TypeScript configuration first.

#### Scenario: Defaults

- **WHEN** `js-to-ts` is not configured
- **THEN** it type-checks with `npx tsc --noEmit --incremental`, tests with `{testRunner} --findRelatedTests {file}`, has no helpers, and `@ts-expect-error` is forbidden

#### Scenario: Old codemod option

- **WHEN** the configuration sets `steps.js-to-ts.codemod`
- **THEN** it is rejected with an error naming `codemod`

#### Scenario: No tsconfig

- **WHEN** `js-to-ts` is enabled and the target has no `tsconfig.json`
- **THEN** the run refuses to start and processes no file
