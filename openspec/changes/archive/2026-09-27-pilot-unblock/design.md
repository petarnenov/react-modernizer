# Design

## Context

The pilot run of 2026-09-27 (`pilot-one-all.yaml`) failed `sanitizerFunctions.js` in `js-to-ts` on the token budget.
The investigation found four independent causes (see proposal). Each fix below is small and deterministic; none of
them involves the model deciding anything new.

## Decisions

### 1. Jest failures as baseline errors

`newErrorsOnly: jest` reuses the existing baseline machinery (`ReportedError`, counts per file and `what`,
`newErrors`, renamed files through `baseName`, per-file baselines taken on the untouched file before the first step).
Only a parser is new.

Parsing Jest's default reporter output (stdout and stderr are already merged by `runCommand`):

- ANSI escapes are stripped first.
- `PASS <path>` / `FAIL <path>` (optionally followed by a duration) sets the current test file and whether it failed.
- Under a `FAIL` file, a line `  ● <title>` is one failing test: `file` is the test file, `what` is the title
  (`Describe › test`). `● Test suite failed to run` is parsed the same way, so a suite that cannot run is one error of
  that file. `● Console` blocks (printed under passing and failing files alike) are skipped.
- The following indented lines, up to 12 non-empty ones and stopping at the next `●`, `PASS`/`FAIL` or unindented
  line, are appended to `text`, so the model sees Jest's message for a new failure without the whole DOM dump.
- Parsing stops at `Summary of all failing tests`, which Jest prints after many suites and which repeats every
  failure; counting it would double every baseline entry.

Why the text reporter and not `--json`: the gate command is the user's, and `--json` would need the command changed and
its JSON separated from interleaved stderr. The text format has been stable across Jest 24–30. A crash that prints no
`FAIL` line is still caught by the existing rule: a non-zero exit with nothing parsed fails as a plain command.

Known limit: a test that fails before and after the step for a different reason counts as the same failure. That is
the same trade-off lint and type errors already make (compared by message, not position), and a step's own
characterization test is new or renamed, so it has no baseline to hide behind unless it already failed.

Cost: one extra run of the test gate on the untouched file per file (the lint gate already does this). For the pilot
that is about 1 min 20 s, once, against 1 min 24 s per rejected attempt today.

### 2. Keep the latest read of every file

`compact()` already keeps the latest read of own files and turns earlier reads of the same path into notes. The set of
paths becomes every path read, not `ownFiles`. Nothing else used `ToolRunRequest.ownFiles`, so it is removed, with
the five steps that passed it.

In `runTools`, when a `read_file` result is identical to the latest recorded read of the same path, it is recorded as
a note — `[<path> is unchanged since your read on turn N; that result is still above, in full]` — without a `path`, so
it does not supersede the earlier read. Error results (`Error: …`) are recorded as they are.

Context growth is bounded by the distinct files read; in the pilot that is about eight files, far less than eight
copies of each.

### 3. An unchanged attempt ends the step

In `processFile`, after a gate failure the staged tree hash is remembered. After a later attempt of the same step, if
the staged tree equals it, the step fails at once: no gates, no further attempts. The reason is the last gate failure
prefixed by `attempt N changed nothing since the gates rejected it`. The existing "unchanged step passes" rule (tree
equals the tree before the step) is checked first and is unaffected.

Gates are deterministic enough for this: rerunning them on an identical tree would give the same answer except for
flaky tests, and a flaky pass is not something to spend a model attempt on.

### 4. Retry line

`progress.ts` prints `firstLine(reason)`. For a line ending in `:` it appends the first non-empty line after it. No
file contents leak: the gate's first output line is a count or an error location.

## Risks

- A Jest version with a different reporter layout parses to zero failures; with a non-zero exit the gate then fails
  with the full output, as today. No silent pass.
- Keeping all reads could exceed a small model context on a step that reads very many files; the budget still caps it.
