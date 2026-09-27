## MODIFIED Requirements

### Requirement: JS-to-TS options

The `js-to-ts` step SHALL accept `typecheckCommand` (default
`npx tsc --noEmit --incremental --tsBuildInfoFile {cache}/tsc.tsbuildinfo`), `testCommand` (default
`{testRunner} {testFile}`, where `{testFile}` is the file's characterization test after renaming) and `helpers`, a
list of files with shared types for the model to use (for example typed Redux hooks). It SHALL NOT accept `codemod`.
`gates.forbid` SHALL include `@ts-expect-error` by default, alongside `: any`, `as any`, `@ts-ignore` and
`@ts-nocheck`. When `js-to-ts` is enabled and the target has no `tsconfig.json`, the run SHALL refuse to start and
say that the project needs a TypeScript configuration first.

#### Scenario: Defaults

- **WHEN** `js-to-ts` is not configured
- **THEN** it type-checks with `npx tsc --noEmit --incremental --tsBuildInfoFile {cache}/tsc.tsbuildinfo`, tests with `{testRunner} {testFile}`, has no helpers, and `@ts-expect-error` is forbidden

#### Scenario: Old codemod option

- **WHEN** the configuration sets `steps.js-to-ts.codemod`
- **THEN** it is rejected with an error naming `codemod`

#### Scenario: No tsconfig

- **WHEN** `js-to-ts` is enabled and the target has no `tsconfig.json`
- **THEN** the run refuses to start and processes no file
