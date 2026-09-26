# import-graph Specification

## Purpose

Discovers the files of a target codebase and what each of them imports, resolved the way the application's own
build resolves them, so work can be ordered by dependency and problems in the graph are visible before any run.

## Requirements

### Requirement: Deterministic discovery

The tool SHALL discover the files to process from the configured source selection and SHALL return them in a
stable, sorted order, so the same codebase always yields the same files in the same order. Discovery SHALL NOT
follow into `node_modules`, and SHALL NOT write anything into the target.

#### Scenario: Stable result

- **WHEN** discovery runs twice on an unchanged target
- **THEN** both runs return the same files in the same order

#### Scenario: Dependencies are not project files

- **WHEN** the include pattern would also match files under `node_modules`
- **THEN** no file under `node_modules` is discovered

### Requirement: Import extraction

For every discovered file the tool SHALL extract the module specifiers it imports: static `import` declarations
including side-effect imports, `export … from`, dynamic `import()` with a string literal, and `require()` with a
string literal. Files containing JSX SHALL be read correctly. A file that cannot be parsed SHALL be reported with its
path and SHALL still take part in the graph with the imports that could be read.

#### Scenario: All import forms

- **WHEN** a file contains `import A from './a'`, `import './b.css'`, `export { c } from './c'`, `import('./d')` and `require('./e')`
- **THEN** the specifiers `./a`, `./b.css`, `./c`, `./d` and `./e` are extracted

#### Scenario: Computed specifier

- **WHEN** a file contains `import(`./pages/${name}`)`
- **THEN** that import is not extracted and the file is reported as having a dynamic import that cannot be followed

### Requirement: Resolution like the application

Each specifier SHALL be resolved the way a Create React App project resolves it:

- a relative specifier against the importing file's directory;
- a bare specifier first against `baseUrl` from `jsconfig.json` or `tsconfig.json` at the target root, when one is
  set and a matching file exists, otherwise as a package;
- trying the path as written, then with the extensions `.js`, `.jsx`, `.ts`, `.tsx` in that order, then as a
  directory containing `index` with those extensions.

#### Scenario: Omitted extension

- **WHEN** `src/pages/Home.jsx` imports `../components/Card` and `src/components/Card.jsx` exists
- **THEN** the import resolves to `src/components/Card.jsx`

#### Scenario: Directory index

- **WHEN** a file imports `./components` and `src/components/index.js` exists
- **THEN** the import resolves to `src/components/index.js`

#### Scenario: Absolute import from baseUrl

- **WHEN** `jsconfig.json` sets `baseUrl` to `src` and a file imports `components/Card`
- **THEN** the import resolves to `src/components/Card.jsx`

#### Scenario: Package import

- **WHEN** a file imports `react-redux` and no `react-redux` exists under `baseUrl`
- **THEN** the import is classified as a package

### Requirement: Every import is classified

Each import SHALL be classified as exactly one of: **internal** (resolves to a discovered file), **outside the set**
(resolves to a project file that is not being processed, such as a TypeScript file or an excluded file), **asset**
(resolves to or names a non-code file such as CSS, an image or JSON), **package**, or **unresolved** (relative or
under `baseUrl`, but no file found). Only internal imports SHALL become edges of the graph. Unresolved imports SHALL
be reported with the importing file and the specifier, and SHALL NOT stop the tool.

#### Scenario: Import of an already migrated file

- **WHEN** `Card.jsx` imports `./api` and only `src/api.ts` exists
- **THEN** the import is classified as outside the set and adds no edge

#### Scenario: Broken import

- **WHEN** `Card.jsx` imports `./Missing` and no such file exists
- **THEN** the import is classified as unresolved, reported with `Card.jsx` and `./Missing`, and the graph is still built

#### Scenario: Stylesheet

- **WHEN** a file imports `./Card.module.css`
- **THEN** the import is classified as an asset and adds no edge

### Requirement: Import cycles are found

The tool SHALL find every group of files that import each other directly or indirectly, and report each group with
its files. A file importing itself SHALL NOT count as a cycle.

#### Scenario: Indirect cycle

- **WHEN** `a` imports `b`, `b` imports `c`, and `c` imports `a`
- **THEN** one cycle is reported containing `a`, `b` and `c`

#### Scenario: No cycles

- **WHEN** the graph has no files that import each other
- **THEN** no cycle is reported

### Requirement: Large codebases

Building the graph for a codebase of 8000 files SHALL complete without calling any model and SHALL take no more
than 30 seconds on a typical developer machine.

#### Scenario: Generated 8000-file codebase

- **WHEN** the graph is built for a generated target of 8000 files, each with several imports
- **THEN** it completes within 30 seconds
