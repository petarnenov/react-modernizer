## MODIFIED Requirements

### Requirement: Importers that would break

Before renaming, the step SHALL check the file's importers: every code file under the project's source roots that
imports it, whether or not that file is part of the run. When any of them imports the file with an explicit
JavaScript extension, the attempt SHALL fail without a model call, naming each such importer and its import.

#### Scenario: Explicit extension

- **WHEN** `src/Page.jsx` imports `./Card.jsx`
- **THEN** `src/Card.jsx` fails naming `src/Page.jsx` and `./Card.jsx`, and no model call is made

#### Scenario: Importer outside the run

- **WHEN** only `src/Card.jsx` is included and `src/Page.tsx`, not included, imports `./Card.jsx`
- **THEN** `src/Card.jsx` fails naming `src/Page.tsx`

## ADDED Requirements

### Requirement: Fitting the importers

The model SHALL be given the paths of the file's importers (at most 20, then how many more), and SHALL be told that
it can change only its own two files; that type errors reported in other files mean its types do not fit how those
files use the module; that it must widen or adjust its own types to fit them; and that it should read only the lines
around each reported error.

#### Scenario: Importers listed

- **WHEN** `src/Card.jsx` is imported by `src/Page.tsx` and `src/List.tsx`
- **THEN** the prompt names both files and states how to react to errors in them

#### Scenario: Many importers

- **WHEN** 45 files import the file
- **THEN** the prompt names 20 of them and says there are 25 more
