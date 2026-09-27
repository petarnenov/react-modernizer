# Tasks

## 1. Jest baseline

- [x] 1.1 `jest` in `ERROR_FORMATS`; parser for Jest's default report (ANSI stripped, `FAIL`/`PASS` file, `●` titles, `● Console` skipped, up to 12 detail lines, stop at `Summary of all failing tests`)
- [x] 1.2 Default test gate `{ run: '{testRunner} --findRelatedTests {files}', newErrorsOnly: 'jest' }`
- [x] 1.3 Per-file baselines read absolute paths through the worktree's real path too, as the gates do (fixes the failing `takes a per-file baseline … following a rename` test)
- [x] 1.4 Tests: parser (failing tests, suite failed to run, console blocks, summary not double-counted, ANSI); gate passes on a baseline failure, fails on a new one with its message; renamed test file keeps its baseline; config default

## 2. Re-reads

- [x] 2.1 `compact()` keeps the latest read of every path; earlier reads of the same path noted
- [x] 2.2 `runTools`: a read identical to the latest read of that path is recorded as an "unchanged since turn N" note without a path; errors recorded as they are
- [x] 2.3 Tests: non-own file read on turn 1 still full on turn 10; unchanged re-read is a note and the first read stays; changed file re-read supersedes

## 3. Unchanged attempt

- [x] 3.1 `processFile`: remember the staged tree at each gate failure; an attempt ending on that tree fails the step at once with the gate failure and a note
- [x] 3.2 Test: gate fails attempt 1, attempt 2 writes nothing → gates run once, no attempt 3, reason carries the gate failure

## 4. Progress

- [x] 4.1 Retry line appends the first non-empty line after a first line ending in `:`
- [x] 4.2 Test for the retry line

## 5. Docs and verification

- [x] 5.1 README (`newErrorsOnly: jest`, compaction), `modernizer.config.example.yaml`, docs/design.md defaults
- [x] 5.2 `confine` compares a not-yet-existing path through its nearest existing directory's real path (fixes `accepts a path inside the project` under macOS `/var` → `/private/var`)
- [x] 5.3 `npm run verify` green
- [x] 5.4 Pilot `pilot-one-all.yaml` with the test gate as `newErrorsOnly: jest`: file done, or failed for a reason other than the budget, under 500k tokens
