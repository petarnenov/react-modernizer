# Tasks

## 1. Compaction

- [ ] 1.1 `ToolRunRequest.ownFiles`; the five steps pass their file and test
- [ ] 1.2 Ollama: record path per tool result and turn per assistant message; latest own-file read kept, superseded reads noted; old `thinking` dropped
- [ ] 1.3 Tests: own file kept at turn 10, second read supersedes the first, other files noted, old thinking dropped and recent kept, pairing intact

## 2. js-to-ts tests

- [ ] 2.1 Default `testCommand` `{testRunner} {testFile}`; `{testFile}` replaced; no test → nothing run, model told
- [ ] 2.2 Tests: default, own test only, no-test message; configuration default for the type check recorded

## 3. Docs

- [ ] 3.1 README, DECISIONS.md; `npm run verify` green
