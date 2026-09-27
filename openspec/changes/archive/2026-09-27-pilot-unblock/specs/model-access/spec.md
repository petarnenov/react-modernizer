## MODIFIED Requirements

### Requirement: Ollama history compaction

With the Ollama provider, a tool result older than the two most recent model turns SHALL be replaced, in the
messages sent to the model, by a one-line note naming the tool and the path it concerned and saying the tool can be
called again, except the latest result of reading each file, which SHALL always be sent in full. An earlier read of
the same file SHALL be replaced by a note, since a later read supersedes it. When the model reads a file whose content
is identical to the latest read of that path it already has, the result SHALL be a short note saying the file is
unchanged since that read, which stays in full, instead of the content again. Assistant messages older than the two
most recent turns SHALL be sent without their reasoning (`thinking`), keeping their text and tool calls. The system
prompt and the task prompt SHALL be kept as they were.

#### Scenario: Long session

- **WHEN** the model is on its tenth turn and ran the tests on its second
- **THEN** the tenth request carries a note that `run_tests` was called, not the test output

#### Scenario: Recent results

- **WHEN** the model ran the tests on its last turn
- **THEN** the next request carries the full test output

#### Scenario: Own file

- **WHEN** the step works on `src/Card.js`, which the model read on its first turn, and it is on its tenth turn
- **THEN** the tenth request carries the content of `src/Card.js` from that read

#### Scenario: File read long ago

- **WHEN** the model read `src/a.ts` on its first turn and is on its tenth turn
- **THEN** the tenth request carries the content of `src/a.ts` from that read

#### Scenario: Own file read twice

- **WHEN** the model read `src/Card.js` on turn 1, wrote it on turn 4 and read it again on turn 6, and is on its tenth turn
- **THEN** the read from turn 6 is sent in full and the read from turn 1 as a note

#### Scenario: Unchanged file read again

- **WHEN** the model read `src/Percent.tsx` on turn 2 and reads it again on turn 7 without it having changed
- **THEN** the turn-7 result is a note that the file is unchanged since the read on turn 2, and the turn-2 read is still sent in full

#### Scenario: Old reasoning

- **WHEN** the model is on its tenth turn
- **THEN** its messages from turns 1 to 7 are sent without `thinking`, and those from turns 8 and 9 with it
