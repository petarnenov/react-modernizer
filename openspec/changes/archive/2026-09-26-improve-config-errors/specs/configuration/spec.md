# Spec Delta

## MODIFIED Requirements

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
