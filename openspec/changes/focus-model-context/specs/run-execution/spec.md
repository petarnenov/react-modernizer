## MODIFIED Requirements

### Requirement: Per-file transaction

For each file the run SHALL apply the enabled steps in order and run the gates after each step. When the gates
fail after a step, that step SHALL be given the gate failure and run again on its own previous output, up to
`retry.perStep` further attempts. When the gates have passed after every step, the file's changes SHALL be committed
to the run branch as one commit naming the file and the steps applied. A file whose steps apply cleanly but whose
commit cannot be combined with the run branch — because another worker changed the same lines — SHALL be recorded
as failed like any other. When the
attempts are exhausted, the file's changes SHALL be discarded and, with `retry.onFail: revert-and-report`, the file
SHALL be recorded as failed with the reason while the run continues; with `retry.onFail: stop`, the run SHALL stop
after recording it. An error inside a step SHALL be handled like a failed gate. When the last attempt ends in an
error after an earlier attempt failed the gates, the reason SHALL include that gate failure too.

#### Scenario: Accepted file

- **WHEN** the steps change `src/Card.jsx` and the gates pass
- **THEN** the run branch gains one commit containing only that file's changes, and the file is recorded as done

#### Scenario: Retry with the failure

- **WHEN** the gates fail after a step's first attempt and pass after its second
- **THEN** the second attempt receives the first failure, the next step runs, and the file is committed once

#### Scenario: Exhausted attempts

- **WHEN** the gates still fail after `retry.perStep` retries and `onFail` is `revert-and-report`
- **THEN** nothing of that file's change is committed, it is recorded as failed with the gate failure, and the run continues

#### Scenario: Stop on failure

- **WHEN** a file fails and `onFail` is `stop`
- **THEN** no further file is started and the run reports that it stopped

#### Scenario: Unchanged file

- **WHEN** the steps change nothing and the gates pass
- **THEN** no commit is made and the file is recorded as done

#### Scenario: Budget after a gate failure

- **WHEN** the tsc gate fails a step's first attempt and the second attempt runs out of token budget
- **THEN** the file's reason names the budget and also carries the tsc gate's new errors
