# Spec Delta

## ADDED Requirements

### Requirement: Files settled before the run

Before a run starts, files settled by an earlier run SHALL be marked settled with their outcome. A file marked
settled SHALL NOT be handed out, and SHALL count as settled for the files that import it.

#### Scenario: Resuming after an interruption

- **WHEN** `api` and `card` were done in an earlier run, `page` imports `card`, and the run resumes
- **THEN** only `page` is handed out, immediately
