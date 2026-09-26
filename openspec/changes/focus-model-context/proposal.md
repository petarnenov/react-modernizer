# Proposal

## Why

The full-pipeline pilot on one file got through analyze, characterize-tests and class-to-function, then spent 460k
tokens in `js-to-ts` and ran out of budget. The gate correctly rejected the change: the new types caused new type
errors in two TypeScript files that import the module. What went wrong was the model's reaction and the tool's
support for it:

- **The model did not know how to react.** It is not told that it cannot change other files, or that errors in
  importers mean its types must fit how callers use them. It read 12 unrelated files.
- **It did not know the importers.** The import graph covers only `source.include`. In a codebase that is 99.7%
  TypeScript with JavaScript being migrated, every TypeScript importer is invisible. For the same reason the
  "explicit `.js` extension" check misses TypeScript importers.
- **Every Ollama turn resends every earlier tool result**, so input grows with each turn (460k input against 45k
  output).
- **The real reason is lost.** When the budget runs out, the file's reason says only "token budget exhausted", not
  which errors were still unfixed.

## What Changes

- **Importers across the whole project.** A reverse import index covers every code file under the source roots, not
  only included files. It is built once per run with the same resolver. `StepContext.importers` and the
  explicit-extension check use it.
- **`js-to-ts` knows its importers and the rule.** The prompt lists the importers (up to 20, then a count). A new
  instruction says: errors in other files mean your types do not fit how those files use yours; you cannot change
  them; widen your types to match (for example accept the types callers pass, make optional what some omit); read
  only the lines around each reported error.
- **Ollama history compaction.** Tool results older than the two most recent model turns are replaced by a one-line
  note naming the tool and path, telling the model it can call the tool again. The system prompt, task prompt and
  the model's own messages are kept.
- **Reason keeps the last gate failure.** A file that fails on the token budget (or any step error after a gate
  failure) records the last gate failure too, so `status` shows what was still wrong.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `js-to-ts-step`: importers come from the whole project; the model is given the importers and how to react to
  errors in them.
- `model-access`: the Ollama provider compacts older tool results.
- `run-execution`: a failed file's reason keeps the last gate failure when a later error ends the attempts.

## Impact

- `src/graph/` (reverse import index), `src/run/runner.ts`, `src/steps/js-to-ts/` (prompt, instructions),
  `src/model/ollama.ts`, `src/run/transaction.ts`. Tests, DECISIONS.md.
