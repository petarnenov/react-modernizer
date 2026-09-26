import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTestRunner } from '../../config/commands.js';
import type { ModernizerConfig } from '../../config/schema.js';
import type { ModelClient } from '../../model/client.js';
import { shellQuote } from '../../run/gates.js';
import { readTools, reportBugTool, runTestsTool, writeOneFileTool } from '../shared/tools.js';
import type { Step } from '../step.js';
import {
  exportedNames,
  exportsChanged,
  findClassComponents,
  type ClassComponent,
} from './analysis.js';
import { buildPrompt, SYSTEM_PROMPT } from './instructions.js';

const MAX_ITERATIONS = 40;

interface Baseline {
  convert: ClassComponent[];
  skipped: ClassComponent[];
  exports: string[];
}

/** Class components → function components with hooks, in place, in JavaScript. */
export function createClassToFunctionStep(config: ModernizerConfig, model: ModelClient): Step {
  const options = config.steps['class-to-function'];
  const modelName = options.model ?? config.model.default;
  const skip = new Set<string>(options.skip);
  // What the file looked like when the step started, per worktree and file: retries build on their own output,
  // but are judged against the original.
  const baselines = new Map<string, Baseline>();

  return {
    id: 'class-to-function',
    allowedChanges: (file) => [file],
    preflight: () => model.check(modelName),
    async run(ctx) {
      const path = join(ctx.cwd, ctx.file);
      const key = `${ctx.cwd}\0${ctx.file}`;
      if (ctx.attempt === 0) {
        const text = await readFile(path, 'utf8');
        const classes = findClassComponents(ctx.file, text);
        baselines.set(key, {
          convert: classes.filter((c) => !skip.has(c.kind)),
          skipped: classes.filter((c) => skip.has(c.kind)),
          exports: exportedNames(ctx.file, text),
        });
      }
      const baseline = baselines.get(key);
      if (baseline === undefined || baseline.convert.length === 0) {
        return; // nothing to convert: no model call
      }

      await model.runTools(
        {
          model: modelName,
          effort: config.model.effort,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt({
            file: ctx.file,
            convert: baseline.convert,
            skipped: baseline.skipped,
            ...(ctx.previousFailure === undefined ? {} : { previousFailure: ctx.previousFailure }),
          }),
          tools: [
            ...readTools(ctx.cwd),
            writeOneFileTool(
              ctx.cwd,
              ctx.file,
              'write_file',
              `Write the whole converted ${ctx.file}, replacing it. This is the only file you can write.`,
            ),
            runTestsTool(
              ctx.cwd,
              withTestRunner(options.testCommand, config.testRunner).replaceAll(
                '{file}',
                shellQuote(ctx.file),
              ),
              config.gates.timeoutSeconds,
              `Run the tests related to ${ctx.file}, characterization tests included. Finish only when they pass.`,
            ),
            reportBugTool((bug) => {
              ctx.report(bug);
            }, `Record a suspected bug in ${ctx.file}. Keep the current behaviour; this is how a bug gets noticed.`),
          ],
          maxIterations: MAX_ITERATIONS,
        },
        ctx.usage,
      );

      // Checked, not trusted: parse what the model left behind.
      const after = await readFile(path, 'utf8');
      const remaining = findClassComponents(ctx.file, after).filter((c) => !skip.has(c.kind));
      if (remaining.length > 0) {
        throw new Error(
          `class components remain: ${remaining.map((c) => `${c.name} (line ${String(c.line)})`).join(', ')}`,
        );
      }
      const changed = exportsChanged(baseline.exports, exportedNames(ctx.file, after));
      if (changed !== undefined) {
        throw new Error(changed);
      }
    },
  };
}
