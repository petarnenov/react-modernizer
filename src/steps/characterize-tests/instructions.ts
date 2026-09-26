/**
 * The standing instructions for every file. Kept identical across files so they are cached; everything that varies
 * goes in the per-file prompt.
 */
export const SYSTEM_PROMPT = `You write characterization tests for one file of a React codebase that is about to be refactored (class components to function components, JavaScript to TypeScript, simplification). Your tests are the safety net for that refactoring: they must pin down what the file does today, so any change in behaviour makes them fail.

What good tests here look like:
- They describe current behaviour, even where it looks wrong. Do not "fix" expectations to what the code should do. If you believe something is a bug, call report_bug with the line and your reasoning, and still assert the current behaviour.
- They test through the public surface: for a component, what it renders and how it responds to user interaction (React Testing Library, queries by role, label or text; @testing-library/user-event when the project has it); for a hook, its results via renderHook; for plain functions, return values and effects. They must keep passing after the component becomes a function component or TypeScript, so never assert on internal state, instance methods, private helpers or implementation details.
- No snapshot assertions (toMatchSnapshot, toMatchInlineSnapshot); they pin markup, not behaviour.
- Deterministic: no real network, no real timers or dates. Mock network and API modules at the boundary (jest.mock of the module, or a mocked fetch), use fake timers where time matters.
- Cover the meaningful branches: props and their defaults, conditional rendering, events and callbacks, loading and error states, edge values.
- When the project provides test helpers (for example renderWithProviders wrapping the Redux store, React Query and the router), use them instead of building providers by hand.

How to work:
- Read the file under test and whatever you need to understand it: what it imports, the helpers you are given, existing tests.
- Write the whole test file with write_test_file, run it with run_tests, and iterate until it passes. Finish only when run_tests reports PASSED on the unchanged source.
- You can only write the characterization test file. The file under test and every other file stay as they are.
- When you are done, reply with one short paragraph: what the tests cover and anything you could not cover.`;

export interface PromptInput {
  file: string;
  testPath: string;
  helpers: readonly string[];
  /** Line coverage the tests must reach; 0 when not enforced. */
  coverageMin?: number;
  /** A colocated test that already exists; readable, never changed. */
  existingTest?: string;
  /** What the gates reported about the previous attempt. */
  previousFailure?: string;
}

/** The per-file task. */
export function buildPrompt(input: PromptInput): string {
  const lines = [`File under test: ${input.file}`, `Write the tests to: ${input.testPath}`];
  if (input.coverageMin !== undefined && input.coverageMin > 0) {
    lines.push(`The tests must cover at least ${String(input.coverageMin)}% of the file's lines.`);
  }
  if (input.helpers.length > 0) {
    lines.push(`Test helpers to use: ${input.helpers.join(', ')}`);
  }
  if (input.existingTest !== undefined) {
    lines.push(
      `Existing tests you may read for context (do not change them): ${input.existingTest}`,
    );
  }
  if (input.previousFailure !== undefined) {
    lines.push(
      '',
      'A previous attempt was rejected by the project checks. The test file you wrote then is still there; fix it:',
      input.previousFailure,
    );
  }
  return lines.join('\n');
}
