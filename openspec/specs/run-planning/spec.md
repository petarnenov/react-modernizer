# run-planning Specification

## Purpose

Shows, before anything is changed, what a run would do: the order the files would be processed in and the shape of
the import graph, so a codebase can be assessed and a pilot chosen without calling any model.

## Requirements

### Requirement: Plan command

The tool SHALL offer a `plan` command that reads the configuration, builds the import graph of the target, and
prints the order in which the files would be processed — the order the scheduler hands them out when every file
succeeds — without writing anything into the target and without calling any model.

#### Scenario: Order follows dependencies

- **WHEN** `plan` is run on a target where `Page.jsx` imports `Card.jsx` and `Card.jsx` imports `api.js`
- **THEN** the printed order lists `api.js`, then `Card.jsx`, then `Page.jsx`

#### Scenario: Target is not changed

- **WHEN** `plan` is run
- **THEN** no file in the target is created, changed or deleted

### Requirement: Plan statistics

The plan SHALL report: the number of files, the number of internal edges, the number of files that import nothing
internal, the counts of imports by classification, every unresolved import with its file, every file with a dynamic
import that cannot be followed, every file that could not be parsed, and every import cycle with its files.

#### Scenario: Codebase with problems

- **WHEN** the target has one unresolved import and one cycle of two files
- **THEN** the plan reports one unresolved import with its file and specifier, and one cycle naming both files

### Requirement: Machine-readable plan

With `--json` the `plan` command SHALL print the order and the statistics as a single JSON document instead of text,
with file paths relative to the target, so other tools can consume it.

#### Scenario: JSON output

- **WHEN** `plan --json` is run
- **THEN** standard output is one JSON document with the order and statistics, and paths are relative to the target

### Requirement: Plan exit status

The `plan` command SHALL exit zero when the plan was produced, even when there are unresolved imports or cycles, and
non-zero only when the configuration is invalid or the target cannot be read.

#### Scenario: Problems are not failures

- **WHEN** the plan contains unresolved imports and cycles
- **THEN** the command exits zero

#### Scenario: Missing target

- **WHEN** the configured target directory does not exist
- **THEN** the command reports it and exits non-zero
