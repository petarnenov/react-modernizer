# Proposal

## Why

A run processes every selected file, so trying the agent on one file means editing `source.include` in a YAML. That
is how eight `pilot-*.yaml` files and a generator script piled up. The user wants to say on the command line what a run takes:
one file by default, a number of files, all of them, or one named file.

## What Changes

- `run` gets `--files <n|all|path>`: a positive integer, `all` for every selected file, or the path of one file
  relative to the target. A value that is neither a positive integer nor `all` is a path.
- With a path, the run processes only that file. The file must be one the source selection picks; otherwise the run
  is refused, naming the path and whether it was not found or not selected by `source.include`/`exclude`. A file
  already done or failed is processed again. Its dependencies are not processed and need not be settled.
- **BREAKING** Without `--files` a run processes **1** file. Today it processes all of them.
- Files are taken in the existing dependency order (leaves first) among files not yet settled. Repeated runs
  therefore continue with the next files, through the existing resume.
- Once that many files have started, no new file starts. Files already in progress finish.
- The closing line says the limit was reached and how many files remain, and the exit code stays 0. Reaching the
  limit is not a stop.
- `--files 0` and negative numbers are refused before anything runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution`: a new requirement for how many files one run processes, and what the run reports when it reaches
  that number.

## Impact

- `src/cli.ts` (option and parsing), `src/run/runner.ts` (`RunOptions.files`, limit in the pool's stop condition,
  summary line)
- `test/run.test.ts`, and CLI tests wherever `run` is exercised
- README ("pilot" and run examples)
- Existing scripts that expect `run` to process everything need `--files all`.
