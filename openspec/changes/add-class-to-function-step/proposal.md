# Proposal

## Why

The safety net is in place: every file gets characterization tests, they must cover it, and no later step can weaken
them. `class-to-function` is the first step that changes source code, and the one with the most ways to change
behaviour by accident — lifecycle methods have no one-to-one hook equivalent, `setState` batches and merges, instance
fields survive re-renders. It is also the step the codebase needs most before TypeScript: typing a function component
with hooks is far simpler than typing a class.

## What Changes

- **`class-to-function` step**: for each file containing class components, a model rewrites them as function
  components with hooks, in place, keeping the file JavaScript. The characterization tests and every existing test
  that relates to the file must pass **unchanged**.
- **The step changes only the file itself.** Its tools read inside the target, write only the processed file, run
  only the file's related tests, and report suspected bugs. Tests cannot be edited in this step at all — stronger than
  protection, which still allows edits.
- **Nothing to do, nothing spent.** Files without class components are detected from the syntax tree and pass
  through with no model call.
- **Error boundaries stay classes** (React has no hook for `componentDidCatch`), as configured by
  `steps.class-to-function.skip`; a file whose only classes are skipped makes no model call either.
- **Checked, not trusted.** After the model is done, the file is parsed again: no class component may remain (apart
  from skipped ones), and the file's exports must be the same names as before, so no importer breaks. Either failure
  is fed back to the model as the reason for the retry.
- **No conversion without tests.** The run refuses to start with `class-to-function` enabled and
  `characterize-tests` disabled, unless `steps.class-to-function.requireTests` is set to false.
- **Shared step tools.** Reading, listing, running tests and reporting bugs move to one module used by both model
  steps.

## Capabilities

### New Capabilities

- `class-to-function-step`: which files it changes, what it may touch, what counts as done, and the rules for the
  conversion.

### Modified Capabilities

- `configuration`: `class-to-function` gains `testCommand` and `requireTests`, and the run refuses to convert
  without characterization tests.

## Impact

- New `src/steps/class-to-function/` (detection, exports check, instructions, step); new `src/steps/shared/tools.ts`
  extracted from `characterize-tests`.
- `src/config/schema.ts`, `src/steps/registry.ts`, `src/run/runner.ts` (the requireTests check).
- No new dependency: detection and the exports check use the TypeScript parser already in use.
- Costs model calls only for files that contain class components.
