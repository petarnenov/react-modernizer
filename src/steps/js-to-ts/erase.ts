import ts from 'typescript';
import { parseSource } from '../../graph/extract.js';

// One printer for both sides: formatting and comments cannot make a difference.
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

function normalize(fileName: string, text: string): string {
  return printer.printFile(parseSource(fileName, text));
}

/**
 * TypeScript with its types erased. `verbatimModuleSyntax` keeps every import that is not `import type` — without
 * it, TypeScript drops imports it thinks are unused (such as `React` under the new JSX transform).
 */
export function eraseTypes(fileName: string, text: string): string {
  return ts.transpileModule(text, {
    fileName,
    reportDiagnostics: false,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      verbatimModuleSyntax: true,
    },
  }).outputText;
}

/** `src/Card.tsx` → `src/Card.jsx`, `src/format.ts` → `src/format.js`: the name the erased output parses as. */
function erasedName(fileName: string): string {
  return fileName.replace(/\.tsx$/, '.jsx').replace(/\.ts$/, '.js');
}

/**
 * Why the TypeScript is not the original JavaScript plus types, or undefined when it is. Both sides are parsed and
 * printed the same way; the first differing lines (of the normalised code) are shown.
 */
export function typesOnlyDifference(
  original: { fileName: string; text: string },
  typed: { fileName: string; text: string },
): string | undefined {
  const before = normalize(original.fileName, original.text).split('\n');
  const after = normalize(erasedName(typed.fileName), eraseTypes(typed.fileName, typed.text)).split(
    '\n',
  );
  const first = before.findIndex((line, i) => line !== after[i]);
  const at = first === -1 ? (before.length === after.length ? -1 : before.length) : first;
  if (at === -1) {
    return undefined;
  }
  const excerpt = (lines: string[]): string =>
    lines
      .slice(at, at + 3)
      .map((l) => `    ${l}`)
      .join('\n') || '    (nothing)';
  return (
    `${typed.fileName} is not ${original.fileName} with types added — the code itself changed. ` +
    `Only add types; never change, add or remove code (no guards, no enums).\n` +
    `  was (as JavaScript):\n${excerpt(before)}\n  now (types erased):\n${excerpt(after)}`
  );
}
