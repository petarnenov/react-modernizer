# file-scheduling Specification

## Purpose

Decides which file is worked on next: leaves of the import graph first, so each file is migrated after the files it
imports, with at most the configured number of files in progress and no single file able to stop the run.

## Requirements

### Requirement: Dependency order

A file SHALL be handed out only when every file it imports within the processed set is settled, so leaves are
processed before the files that import them. Imports outside the processed set and a file importing itself SHALL be
ignored. A file whose processing failed SHALL count as settled.

#### Scenario: Leaves first

- **WHEN** `page` imports `card` and `card` imports `api`
- **THEN** the files are processed in the order `api`, `card`, `page`

#### Scenario: Dependency still in progress

- **WHEN** `card` imports `api` and `api` is being processed
- **THEN** `card` is not handed out until `api` is settled

#### Scenario: Failed dependency

- **WHEN** `card` imports `api` and processing `api` failed
- **THEN** `card` is still processed

#### Scenario: Imports outside the set

- **WHEN** a file imports `react` or a file excluded from the run
- **THEN** that import does not delay the file

### Requirement: Import cycles do not stall the run

When no file is ready and none is in progress but files remain, the scheduler SHALL hand out the remaining file with
the fewest unsettled imports, so every file is eventually processed.

#### Scenario: Two files importing each other

- **WHEN** `a` imports `b` and `b` imports `a`
- **THEN** both are processed, one after the other

### Requirement: Bounded concurrency

At most the configured number of files SHALL be in progress at once, and every file SHALL be processed exactly once.
With one worker, files SHALL be processed strictly one at a time. A non-positive worker count SHALL be rejected.

#### Scenario: Worker limit

- **WHEN** twenty independent files are processed with three workers
- **THEN** all twenty are processed and never more than three at once

#### Scenario: One worker

- **WHEN** files are processed with one worker
- **THEN** no two files are ever in progress at the same time

### Requirement: One file cannot stop the run

An error while processing a file SHALL mark that file failed and SHALL NOT stop the other files. The run SHALL end
with the outcome of every file.

#### Scenario: A file throws

- **WHEN** processing `bad` throws and `good` imports `bad`
- **THEN** `bad` is recorded as failed, `good` is still processed, and the run reports both outcomes
