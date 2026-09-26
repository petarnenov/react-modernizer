/** Standing instructions, identical for every file so they are cached. */
export const SYSTEM_PROMPT = `You add TypeScript types to one file of a React codebase, and to its characterization tests. The file has already been renamed from .js/.jsx to .ts/.tsx; it still contains the original JavaScript. Your job is types only: when the types are erased, the code must be exactly the original JavaScript again. That is checked by compiling your file back to JavaScript and comparing it with the original, so any change to the code itself — an added guard, a changed expression, a removed line, an enum — is rejected.

Typing rules (strict TypeScript, current industry practice):
- Describe a component's props with an interface or type named after the component (CardProps for Card) and type the props parameter with it; export it when other files may need it. Do not use React.FC.
- Never use any. Use a precise type, or unknown and the narrowing the code already does. Never use @ts-ignore, @ts-expect-error or @ts-nocheck.
- No non-null assertions (!) to silence the compiler; describe what can be null or undefined with the type instead (T | null), and rely on the checks the code already has.
- Type event handlers (React.ChangeEvent<HTMLInputElement>, React.MouseEvent<HTMLButtonElement>, …), state (useState<T>), refs (useRef<HTMLDivElement>(null)), reducers and their actions, context values and custom hooks' return types.
- Use import type for imports used only as types.
- Use union types of literals instead of enum; enums emit JavaScript and are rejected.
- Use the project's shared types and typed helpers when they are given (for example useAppSelector, useAppDispatch, RootState, API response types) instead of re-declaring them.
- In the tests, type what the tests need (mocks, fixtures, rendered props) without changing what they do or assert.
- Do not fix bugs. If something looks wrong, call report_bug with the line and your reasoning.

Files that import yours:
- They are listed in the task. You cannot change them. Their code is right as it is; your types must fit how they use your module.
- A type error reported in one of them means your types are narrower than, or different from, what that file passes or expects. Adjust your own types to fit it: accept the types callers pass, make optional what some callers omit, return what they rely on. Never narrow a type a caller depends on.
- To see what a caller does, read the lines around the reported error in that file; do not explore the rest of the project.

How to work:
- Read the file, its tests, the files it imports and the helpers you are given.
- Write the whole typed file with write_file (and the tests with write_test_file), then run check_types until your files have no errors and run_tests until PASSED.
- You can only write these two files.
- When done, reply with one short paragraph: what you typed and anything you could not type precisely.`;

export interface PromptInput {
  from: string;
  file: string;
  testFrom?: string;
  testFile?: string;
  helpers: readonly string[];
  /** Files that import this one, anywhere in the project. */
  importers?: readonly string[];
  previousFailure?: string;
}

const IMPORTERS_SHOWN = 20;

/** Paths of files the failure reports errors in, other than the step's own. */
function othersIn(failure: string, own: readonly string[]): string[] {
  const found = new Set<string>();
  for (const m of failure.matchAll(/^([^\s(:]+\.[cm]?[jt]sx?)[(:]/gm)) {
    const path = m[1] ?? '';
    if (!own.includes(path)) found.add(path);
  }
  return [...found];
}

/** The per-file task. */
export function buildPrompt(input: PromptInput): string {
  const lines = [`File to type: ${input.file} (was ${input.from})`];
  if (input.testFile !== undefined && input.testFrom !== undefined) {
    lines.push(`Its characterization tests: ${input.testFile} (was ${input.testFrom})`);
  }
  if (input.helpers.length > 0) {
    lines.push(`Shared types and typed helpers to use: ${input.helpers.join(', ')}`);
  }
  const importers = input.importers ?? [];
  if (importers.length > 0) {
    const more = importers.length - IMPORTERS_SHOWN;
    lines.push(
      `Imported by (you cannot change these; your types must fit them): ${importers.slice(0, IMPORTERS_SHOWN).join(', ')}` +
        (more > 0 ? ` and ${String(more)} more` : ''),
    );
  }
  if (input.previousFailure !== undefined) {
    lines.push(
      '',
      'A previous attempt was rejected. The files you wrote then are still there; fix them:',
      input.previousFailure,
    );
    const others = othersIn(input.previousFailure, [
      input.file,
      ...(input.testFile === undefined ? [] : [input.testFile]),
    ]);
    if (others.length > 0) {
      lines.push(
        '',
        `Errors are reported in files you cannot change (${others.join(', ')}): adjust your own types so they fit how those files use them.`,
      );
    }
  }
  return lines.join('\n');
}
