# Tasks

## 1. Importers

- [ ] 1.1 `src/graph/importers.ts`: index of importers over all code files under the source roots
- [ ] 1.2 Runner uses it for `StepContext.importers`
- [ ] 1.3 Tests: an importer outside `source.include` is found; explicit-extension check names it

## 2. js-to-ts prompt

- [ ] 2.1 Prompt lists importers (20 + count); system prompt rule for errors in other files; retry hint when the failure names other files
- [ ] 2.2 Tests: instructions contain the rule; prompt lists importers and the overflow count; retry hint

## 3. Ollama compaction

- [ ] 3.1 Tool results older than the last two turns sent as a one-line note; assistant messages unchanged
- [ ] 3.2 Tests: tenth turn carries the note, last turn's results in full, message order and roles intact

## 4. Failure reason

- [ ] 4.1 Keep the last gate failure; include it when a later error ends the attempts
- [ ] 4.2 Test: budget exhausted after a gate failure records both
- [ ] 4.3 DECISIONS.md; `npm run verify` green
