# Spec Delta

## ADDED Requirements

### Requirement: Home-relative target

A `target` of `~` or starting with `~/` SHALL resolve against the user's home directory, wherever the configuration
file is.

#### Scenario: Project under the home directory

- **WHEN** the configuration sets `target: ~/geowealth/WebContent/react/app` and the home directory is `/Users/pat`
- **THEN** the target is `/Users/pat/geowealth/WebContent/react/app`
