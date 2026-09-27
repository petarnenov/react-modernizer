# Spec Delta

## ADDED Requirements

### Requirement: Written files end with one newline

Every file a step's model writes SHALL be saved ending with exactly one newline character: a missing final newline
SHALL be added, and trailing blank or whitespace-only lines SHALL be reduced to that single newline. Everything
before the end SHALL be saved as written. Files the model does not write SHALL keep their content byte for byte.

#### Scenario: No final newline

- **WHEN** the model writes `src/Card.tsx` with content ending in `export default Card;` and no newline
- **THEN** the file on disk ends with `export default Card;` followed by one newline

#### Scenario: Trailing blank lines

- **WHEN** the model writes a test file ending in `});` followed by three newlines and a line of spaces
- **THEN** the file on disk ends with `});` followed by one newline

#### Scenario: Already one newline

- **WHEN** the model writes content that ends with exactly one newline
- **THEN** the file on disk is exactly that content
