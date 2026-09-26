# Spec Delta

## ADDED Requirements

### Requirement: Coverage gate

After a step, when the processed file has tests written by a step that produces tests, the file's line coverage by
those tests SHALL be measured with the configured test runner. The gates SHALL fail when it is below
`gates.coverage.min`, and the failure SHALL state the measured percentage, the minimum, and the uncovered line numbers
of the file. When the file has no such tests yet, or the minimum is 0, no coverage SHALL be measured. Coverage output
SHALL be written outside the worktree, so it is never part of the file's change.

#### Scenario: Enough coverage

- **WHEN** the characterization tests cover 92% of `src/Card.jsx`'s lines and the minimum is 80
- **THEN** the coverage gate passes

#### Scenario: Too little coverage

- **WHEN** they cover 55% and lines 12–18 and 30 are never run
- **THEN** the gates fail with a message stating 55%, the minimum 80%, and lines 12–18 and 30, and the step's retry receives it

#### Scenario: Renamed file

- **WHEN** an earlier step renamed `src/Card.jsx` to `src/Card.tsx`
- **THEN** coverage is measured for `src/Card.tsx`

### Requirement: Test protection

Once the step named in `gates.protectTestsFrom` has passed for a file, the tests it wrote SHALL be protected for the
rest of that file's pipeline. A later step SHALL fail its attempt when it deletes a protected test file, reduces the
number of test cases or `expect` assertions in it, or introduces `.skip`, `.only`, `xit`, `xtest`, `xdescribe`,
`it.todo` or `test.todo` in it. Renaming a protected test file, for example to `.tsx`, and editing it otherwise SHALL be
allowed. With `gates.protectTestsFrom` set to null, no tests SHALL be protected.

#### Scenario: Deleted assertion

- **WHEN** `js-to-ts` removes one of twelve `expect` calls from `Card.characterization.test.jsx`
- **THEN** the attempt fails, naming the test file and the drop from twelve to eleven assertions

#### Scenario: Skipped test

- **WHEN** `simplify` changes `it('opens', …)` to `it.skip('opens', …)`
- **THEN** the attempt fails, naming the skipped test

#### Scenario: Converted to TypeScript

- **WHEN** `js-to-ts` renames the test file to `Card.characterization.test.tsx`, adds types, and keeps every test and assertion
- **THEN** protection passes

#### Scenario: Deleted test file

- **WHEN** a later step deletes the protected test file
- **THEN** the attempt fails naming the file
