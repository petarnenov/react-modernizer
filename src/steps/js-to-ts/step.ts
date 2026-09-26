import { access, readFile, rename } from 'node:fs/promises';
import { join, posix } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { withTestRunner } from '../../config/commands.js';
import type { ModernizerConfig } from '../../config/schema.js';
import { parseSource } from '../../graph/extract.js';
import { defineTool, type ModelClient } from '../../model/client.js';
import { runCommand, shellQuote } from '../../run/gates.js';
import { characterizationTestPath } from '../characterize-tests/paths.js';
import { exportedValueNames, exportsChanged } from '../class-to-function/analysis.js';
import { readTools, reportBugTool, runTestsTool, writeOneFileTool } from '../shared/tools.js';
import type { Importer, Step } from '../step.js';
import { typesOnlyDifference } from './erase.js';
import { buildPrompt, SYSTEM_PROMPT } from './instructions.js';

const MAX_ITERATIONS = 50;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export function containsJsx(fileName: string, text: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
    } else if (!found) {
      ts.forEachChild(node, visit);
    }
  };
  visit(parseSource(fileName, text));
  return found;
}

/** `src/Card.jsx` → `src/Card.tsx` with JSX, `src/format.js` → `src/format.ts` without. */
export function typedPath(file: string, jsx: boolean): string {
  const stem = file.slice(0, file.length - posix.extname(file).length);
  return `${stem}${jsx ? '.tsx' : '.ts'}`;
}

function isTypeScript(file: string): boolean {
  return /\.tsx?$/.test(file);
}

/** Importers that name the file with its JavaScript extension — they break when it is renamed. */
export function breakingImporters(importers: readonly Importer[]): Importer[] {
  return importers.filter((i) => /\.jsx?$/.test(i.specifier));
}

/** Type-check output lines about the given files, with their continuation lines. */
export function errorsFor(output: string, files: readonly string[]): string {
  const kept: string[] = [];
  let keeping = false;
  for (const line of output.split('\n')) {
    if (/^\s/.test(line) && line.trim() !== '') {
      if (keeping) kept.push(line);
      continue;
    }
    keeping = files.some((f) => line.startsWith(f));
    if (keeping) kept.push(line);
  }
  return kept.join('\n').trim();
}

interface Baseline {
  skip?: true;
  blocked?: string;
  from: string;
  to: string;
  original: string;
  exports: string[];
  test?: { from: string; to: string; original: string };
}

/** JavaScript → TypeScript: the step renames, the model adds types, and code proves nothing else changed. */
export function createJsToTsStep(config: ModernizerConfig, model: ModelClient): Step {
  const options = config.steps['js-to-ts'];
  const modelName = options.model ?? config.model.default;
  const baselines = new Map<string, Baseline>();

  const typecheck = async (cwd: string, files: readonly string[]): Promise<string> => {
    const result = await runCommand(options.typecheckCommand, cwd, config.gates.timeoutSeconds);
    return result.ok ? '' : errorsFor(result.output, files);
  };

  return {
    id: 'js-to-ts',
    allowedChanges: (file) => {
      const test = characterizationTestPath(file);
      return [
        file,
        typedPath(file, true),
        typedPath(file, false),
        test,
        typedPath(test, true),
        typedPath(test, false),
      ];
    },
    preflight: () => model.check(modelName),
    async run(ctx) {
      const key = `${ctx.cwd}\0${ctx.file}`;
      if (ctx.attempt === 0) {
        baselines.delete(key);
        if (isTypeScript(ctx.file)) {
          baselines.set(key, {
            skip: true,
            from: ctx.file,
            to: ctx.file,
            original: '',
            exports: [],
          });
        } else {
          const breaking = breakingImporters(ctx.importers);
          const original = await readFile(join(ctx.cwd, ctx.file), 'utf8');
          const to = typedPath(ctx.file, containsJsx(ctx.file, original));
          const baseline: Baseline = {
            from: ctx.file,
            to,
            original,
            exports: exportedValueNames(ctx.file, original),
          };
          if (breaking.length > 0) {
            baseline.blocked =
              `renaming ${ctx.file} would break importers that name it with its extension: ` +
              breaking.map((i) => `${i.file} imports '${i.specifier}'`).join(', ') +
              ' — drop the extension there first';
          } else {
            const testFrom = characterizationTestPath(ctx.file);
            if (await exists(join(ctx.cwd, testFrom))) {
              const testText = await readFile(join(ctx.cwd, testFrom), 'utf8');
              const testTo = typedPath(testFrom, containsJsx(testFrom, testText));
              baseline.test = { from: testFrom, to: testTo, original: testText };
              await rename(join(ctx.cwd, testFrom), join(ctx.cwd, testTo));
            }
            await rename(join(ctx.cwd, ctx.file), join(ctx.cwd, to));
          }
          baselines.set(key, baseline);
        }
      }
      const baseline = baselines.get(key);
      if (baseline === undefined || baseline.skip === true) {
        return; // already TypeScript: no model call
      }
      if (baseline.blocked !== undefined) {
        throw new Error(baseline.blocked);
      }

      const files = [baseline.to, ...(baseline.test === undefined ? [] : [baseline.test.to])];
      await model.runTools(
        {
          model: modelName,
          effort: config.model.effort,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt({
            from: baseline.from,
            file: baseline.to,
            helpers: options.helpers,
            ...(baseline.test === undefined
              ? {}
              : { testFrom: baseline.test.from, testFile: baseline.test.to }),
            ...(ctx.previousFailure === undefined ? {} : { previousFailure: ctx.previousFailure }),
          }),
          tools: [
            ...readTools(ctx.cwd),
            writeOneFileTool(
              ctx.cwd,
              baseline.to,
              'write_file',
              `Write the whole typed ${baseline.to}, replacing it.`,
            ),
            ...(baseline.test === undefined
              ? []
              : [
                  writeOneFileTool(
                    ctx.cwd,
                    baseline.test.to,
                    'write_test_file',
                    `Write the whole typed ${baseline.test.to}, replacing it. Types only: every test and assertion stays.`,
                  ),
                ]),
            defineTool({
              name: 'check_types',
              description: `Type-check the project and get the errors in ${files.join(' and ')}. Empty means none.`,
              inputSchema: z.object({}),
              run: async () => (await typecheck(ctx.cwd, files)) || 'no type errors in your files',
            }),
            runTestsTool(
              ctx.cwd,
              withTestRunner(options.testCommand, config.testRunner).replaceAll(
                '{file}',
                shellQuote(baseline.to),
              ),
              config.gates.timeoutSeconds,
              `Run the tests related to ${baseline.to}. Finish only when they pass.`,
            ),
            reportBugTool((bug) => {
              ctx.report(bug);
            }, `Record a suspected bug in ${baseline.to}. Keep the current behaviour; this is how a bug gets noticed.`),
          ],
          maxIterations: MAX_ITERATIONS,
        },
        ctx.usage,
      );

      // Checked, not trusted.
      const typed = await readFile(join(ctx.cwd, baseline.to), 'utf8');
      const problems: string[] = [];
      const source = typesOnlyDifference(
        { fileName: baseline.from, text: baseline.original },
        { fileName: baseline.to, text: typed },
      );
      if (source !== undefined) problems.push(source);
      if (baseline.test !== undefined) {
        const tests = typesOnlyDifference(
          { fileName: baseline.test.from, text: baseline.test.original },
          {
            fileName: baseline.test.to,
            text: await readFile(join(ctx.cwd, baseline.test.to), 'utf8'),
          },
        );
        if (tests !== undefined) problems.push(tests);
      }
      const changed = exportsChanged(baseline.exports, exportedValueNames(baseline.to, typed));
      if (changed !== undefined) problems.push(changed);
      if (problems.length === 0) {
        const errors = await typecheck(ctx.cwd, files);
        if (errors !== '') problems.push(`type errors remain:\n${errors}`);
      }
      if (problems.length > 0) {
        throw new Error(problems.join('\n\n'));
      }
    },
  };
}
