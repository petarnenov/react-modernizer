## MODIFIED Requirements

### Requirement: Ollama history compaction

With the Ollama provider, a tool result older than the two most recent model turns SHALL be replaced, in the
messages sent to the model, by a one-line note naming the tool and the path it concerned and saying the tool can be
called again, except the latest result of reading each of the step's own files (the file being processed and its
test), which SHALL always be sent in full. An earlier read of the same own file SHALL be replaced by a note, since a
later read supersedes it. Assistant messages older than the two most recent turns SHALL be sent without their
reasoning (`thinking`), keeping their text and tool calls. The system prompt and the task prompt SHALL be kept as
they were.

#### Scenario: Long session

- **WHEN** the model is on its tenth turn and read `src/a.ts`, which is not one of the step's own files, on its second
- **THEN** the tenth request carries a note that `read_file src/a.ts` was called, not the file's content

#### Scenario: Recent results

- **WHEN** the model ran the tests on its last turn
- **THEN** the next request carries the full test output

#### Scenario: Own file

- **WHEN** the step works on `src/Card.js`, which the model read on its first turn, and it is on its tenth turn
- **THEN** the tenth request carries the content of `src/Card.js` from that read

#### Scenario: Own file read twice

- **WHEN** the model read `src/Card.js` on turns 1 and 6 and is on its tenth turn
- **THEN** the read from turn 6 is sent in full and the read from turn 1 as a note

#### Scenario: Old reasoning

- **WHEN** the model is on its tenth turn
- **THEN** its messages from turns 1 to 7 are sent without `thinking`, and those from turns 8 and 9 with it
