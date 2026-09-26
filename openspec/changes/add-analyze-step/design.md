# Design

## Context

See proposal.md for why. What exists: four model steps built the same way (shared confined tools, `allowedChanges`,
per-file baselines, `ModelClient`), `report_bug` in every step producing `BugReport { line?, reason }`, findings stored
per file in the state and listed by `status`, `measure()` for code lines, `{testRunner}` expansion, and `runCommand`.
`analyze` is first in `STEP_IDS` and enabled by default, but has no implementation.

## Goals / Non-Goals

**Goals:**

- A findings list a person can act on: located, rated, with a reason, and attributed to a step.
- Zero risk to the code: the step cannot write.
- Evidence first: the linter's view of the file goes in, so the model confirms or dismisses real signals.

**Non-Goals:**

- Fixing anything. Filing issues or opening PRs from findings (a later batching/report change).
- Cross-file analysis beyond reading what the file imports.
- Deduplicating findings across steps; each step's findings stay its own.

## Decisions

### 1. No write tool, and `allowedChanges: []`

The step's tools are `read_file`, `list_directory` and `report_bug`. `allowedChanges` returns an empty list, so the
transaction puts back and fails any change — the second line of defence behind having no tool that could make one.
With nothing changed, the gates still run on the unchanged file, as they do for every step.

### 2. Lint evidence before the call

`lintCommand` (with `{file}` quoted) runs in the worktree under the gate timeout. Its output — trimmed to the last
10 000 characters — goes into the per-file prompt under "Linter output". A non-zero exit is normal for a linter with
findings; only a command that cannot start (e.g. no ESLint installed) yields "no lint evidence". Either way the step
continues.

### 3. Severity and step on every finding

`BugReport` gains optional `severity: 'high' | 'medium' | 'low'` and `step`. `reportBugTool` gets an optional
`severity` input shared by all steps (existing steps' instructions are unchanged; they may use it). The transaction
stamps `step` on every report from the step that made it, so steps cannot misattribute. The `analyze` step requires
severity in its own instructions; the tool keeps it optional so other steps stay unchanged.

### 4. `status` grouping

Findings are collected from all files, sorted high → medium → low → unrated, then by file and line, and printed as
`[high] src/Cart.jsx:31 (analyze) reason`. The summary line gains per-severity counts.

### 5. Instructions

A cacheable system prompt with the checklist from the spec and the rules: report only what you can point to in the
code; one finding per problem; use the linter output as evidence but judge it; no style remarks; change nothing. The
per-file prompt names the file, its existing tests if any, its importers (from `ctx.importers`, so the model knows how
it is used), and the lint output.

### 6. Size filter

`minLines` uses `measure()` like `simplify`. Default 0 because bugs hide in small files too; users who want to save
cost raise it or pick a cheaper `steps.analyze.model`.

## Risks / Trade-offs

- [Noise: models over-report] → Severity definitions are concrete; "report only what you can point to"; findings never
  block a file, so noise costs reading time, not progress.
- [Cost: one call per file for all 8000 files] → `minLines` and a per-step model; `status` shows tokens so the pilot
  measures cost per file before a full run.
- [ESLint output format differences] → The evidence is text for the model, not parsed by code; any formatter works.

## Open Questions

None that change the approach.
