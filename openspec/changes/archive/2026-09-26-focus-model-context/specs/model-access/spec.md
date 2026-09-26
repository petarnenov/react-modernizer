## ADDED Requirements

### Requirement: Ollama history compaction

With the Ollama provider, a tool result older than the two most recent model turns SHALL be replaced, in the
messages sent to the model, by a one-line note naming the tool and the path it concerned and saying the tool can be
called again. The system prompt, the task prompt and the model's own messages SHALL be kept as they were.

#### Scenario: Long session

- **WHEN** the model is on its tenth turn and read `src/a.ts` on its second
- **THEN** the tenth request carries a note that `read_file src/a.ts` was called, not the file's content

#### Scenario: Recent results

- **WHEN** the model ran the tests on its last turn
- **THEN** the next request carries the full test output
