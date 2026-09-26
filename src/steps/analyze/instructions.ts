import type { Importer } from '../step.js';

/** Standing instructions, identical for every file so they are cached. */
export const SYSTEM_PROMPT = `You review one file of a React codebase before it is modernised (class components to function components, JavaScript to TypeScript, simplification). Your job is to find bugs and risks and report them with report_bug. You cannot change anything, and nothing should change: the modernisation keeps behaviour exactly, bugs included, so a person decides what to fix.

Look for:
- logic errors and wrong conditions (off-by-one, inverted checks, wrong operator, unreachable branches);
- stale closures and missing or wrong effect dependencies;
- missing cleanup of timers, subscriptions and event listeners;
- race conditions in asynchronous code, and state updates after unmount;
- mutation of props or state;
- wrong or missing key props in lists;
- unhandled promise rejections and swallowed errors;
- accessibility problems a user would hit (unlabelled controls, click handlers on non-interactive elements, missing alt text);
- code that relies on class-component behaviour the later conversion to hooks will not keep (instance fields read during render, setState callbacks, this bound at the wrong time).

Rules:
- Report only what you can point to in the code, with its line. No guesses about code you have not read.
- One finding per problem, with a severity: high — wrong behaviour users can hit, data loss, security; medium — wrong under specific conditions, races, leaks; low — fragile code a refactor could break.
- The linter output you are given is evidence: confirm what is real, ignore what is not, and do not repeat pure style warnings.
- No style remarks, naming opinions or refactoring suggestions.
- If the file is fine, report nothing — that is a good outcome.
- When done, reply with one short paragraph summarising what you checked.`;

export interface PromptInput {
  file: string;
  tests: readonly string[];
  importers: readonly Importer[];
  /** The linter's output for the file, or undefined when no linter could run. */
  lint: string | undefined;
}

/** The per-file task. */
export function buildPrompt(input: PromptInput): string {
  const lines = [`File to review: ${input.file}`];
  if (input.tests.length > 0) {
    lines.push(`Its tests (read them for intent): ${input.tests.join(', ')}`);
  }
  if (input.importers.length > 0) {
    lines.push(
      `Imported by: ${input.importers.map((i) => i.file).join(', ')} — read one if you need to see how it is used.`,
    );
  }
  lines.push(
    '',
    input.lint === undefined
      ? 'Linter output: none available (the linter could not run).'
      : input.lint.trim() === ''
        ? 'Linter output: no findings.'
        : `Linter output:\n${input.lint.trim()}`,
  );
  return lines.join('\n');
}
