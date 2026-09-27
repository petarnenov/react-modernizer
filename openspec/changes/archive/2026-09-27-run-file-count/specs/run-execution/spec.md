# Spec Delta

## ADDED Requirements

### Requirement: Files per run

The `run` command SHALL take `--files <n|all|path>`: a positive integer, `all`, or the path of one file relative to
the target; a value that is neither a positive integer nor `all` SHALL be taken as a path. Without it, a run SHALL
process one file. A run SHALL start at most that many files, taken in dependency order from the files not yet settled. Once that
many have started, no new file SHALL start, and files already in progress SHALL finish. With `all`, every file not yet
settled SHALL be processed. When the limit ends the run while files remain, the closing line SHALL say that the limit
was reached and how many files remain, and the run SHALL exit as a finished run, not a stopped one. With a path, the run SHALL process only that file,
whether or not its dependencies are settled, and SHALL process it again when it is already done or failed. A path
that is not a file the source selection picks SHALL be refused before anything runs, naming the path and whether it
was not found or not selected by `source.include`/`exclude`. Zero and negative numbers SHALL be refused before
anything runs, with a message naming `--files`.

#### Scenario: Default is one file

- **WHEN** `run` is started without `--files` on a target with ten unsettled files
- **THEN** exactly one file is processed, the closing line says 9 remain, and the exit code is 0

#### Scenario: A number of files

- **WHEN** `run --files 3` is started on a target with ten unsettled files, where `api` is imported by the others
- **THEN** three files are processed, `api` first, and seven remain

#### Scenario: Next run continues

- **WHEN** a run with `--files 3` processed three files and `run --files 3` is started again
- **THEN** the next three files are processed and the first three are not processed again

#### Scenario: All files

- **WHEN** `run --files all` is started
- **THEN** every unsettled file is processed

#### Scenario: Fewer files than the limit

- **WHEN** `run --files 50` is started with four unsettled files
- **THEN** the four files are processed and the closing line reports 0 remaining, without mentioning a limit

#### Scenario: Several workers

- **WHEN** `run --files 2 --workers 4` is started with ten unsettled files
- **THEN** two files are processed and never more than two start

#### Scenario: Invalid value

- **WHEN** `run --files 0` is started
- **THEN** the run is refused with a message naming `--files` and nothing is processed

#### Scenario: One named file

- **WHEN** `run --files src/Card.jsx` is started and `src/Card.jsx` imports `src/api.js`, which is not settled
- **THEN** only `src/Card.jsx` is processed

#### Scenario: Named file already settled

- **WHEN** `src/Card.jsx` failed in an earlier run and `run --files src/Card.jsx` is started
- **THEN** `src/Card.jsx` is processed again and its new outcome replaces the old one

#### Scenario: Path not found

- **WHEN** `run --files src/Nope.jsx` is started and there is no such file
- **THEN** the run is refused naming `src/Nope.jsx` as not found, and nothing is processed

#### Scenario: Path not selected

- **WHEN** `source.exclude` is `['src/legacy/**']` and `run --files src/legacy/Old.jsx` is started
- **THEN** the run is refused naming `src/legacy/Old.jsx` as not selected by `source.include`/`exclude`, and nothing is processed
