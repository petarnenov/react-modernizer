# configuration Specification

## Purpose

Defines how a run is configured: one YAML file validated in full before any work starts, with safe defaults for
everything but the target, and command-line overrides that obey the same limits as the file.

## Requirements

### Requirement: Validated configuration file

The tool SHALL read its configuration from a YAML file and validate all of it before doing any work. `target` SHALL
be the only required setting; every other setting SHALL have a default. Unknown keys and out-of-range values SHALL
be rejected, and the error SHALL name every offending setting by its path. A relative `target` SHALL resolve
against the directory of the configuration file, not the current directory.

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
