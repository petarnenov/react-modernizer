# Tasks

## 1. Default

- [x] 1.1 Set the `budget.maxTokensPerFile` default to `1_000_000_000_000` in `src/config/schema.ts` and in `modernizer.config.example.yaml`; verify with a test in `test/config.test.ts` that an unset budget parses to one trillion and a set one is kept
- [x] 1.2 Run `npm run verify` and confirm it passes
