# Tasks

## 1. Runner

- [x] 1.1 Add `files?: FileSelection` to `RunOptions` (default one file), count started files in `work`, and stop handing out files when the limit is reached; verify in `test/run.test.ts`: default processes one of several independent files, `files: 3` processes three with the imported file first, `'all'` processes every file, `files: 2` with 4 workers never starts more than two
- [x] 1.2 Add `limited` to `RunSummary` and the closing line `finished (limit of N reached): … — run again for the next`, keeping `stopped` false; verify in `test/run.test.ts`: limited run reports the remaining count and `stopped` is false, a run with fewer files than the limit does not mention the limit, a second run continues with the next files

- [x] 1.3 Handle a named file: refuse a path not found or not selected (before preflight), process only that file with a one-file scheduler, and process it again when already settled; verify in `test/run.test.ts` with the four scenarios: one named file whose import is unsettled, a failed file processed again, a missing path, an excluded path

## 2. CLI

- [x] 2.1 Add `--files <n|all|path>` to `run` in `src/cli.ts` with a parser that refuses 0 and negatives, reads `all`, and takes other text as a path, and pass it to `runModernizer`; verify with CLI tests: `--files 0` exits with an error naming `--files` and processes nothing, `--files all` is accepted, `--files ./src/Card.jsx` is taken as the path `src/Card.jsx`, `--files some` is refused as not found, a limited run exits 0

## 3. Docs and verify

- [x] 3.1 Update README run examples and the pilot guide to `--files`; verify by reading the README's run section
- [x] 3.2 Run `npm run verify` and confirm it passes
