import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTestRunner } from '../../config/commands.js';
import type { ModernizerConfig } from '../../config/schema.js';
import type { ModelClient } from '../../model/client.js';
import { shellQuote } from '../../run/gates.js';
import { exportedNames, exportsChanged } from '../class-to-function/analysis.js';
import { normalize } from '../shared/normalize.js';
import { readTools, reportBugTool, runTestsTool, writeOneFileTool } from '../shared/tools.js';
import { checkTypesTool, typeErrors } from '../shared/typecheck.js';
import type { Step } from '../step.js';
import { buildPrompt, SYSTEM_PROMPT } from './instructions.js';
import { measure, notSimpler, type Measures } from './metrics.js';

const MAX_ITERATIONS = 40;

interface Baseline {
  text: string;
  measures: Measures;
  exports: string[];
  small: boolean;
}

/** Smaller and clearer, identical behaviour, same surface — accepted only when measurably simpler. */
export function createSimplifyStep(config: ModernizerConfig, model: ModelClient): Step {
  const options = config.steps.simplify;
  const modelName = options.model ?? config.model.default;
  const baselines = new Map<string, Baseline>();

  return {
    id: 'simplify',
    allowedChanges: (file) => [file],
    preflight: () => model.check(modelName),
    async run(ctx) {
      const path = join(ctx.cwd, ctx.file);
      const key = `${ctx.cwd}\0${ctx.file}`;
      if (ctx.attempt === 0) {
        const text = await readFile(path, 'utf8');
        const measures = measure(ctx.file, text);
        baselines.set(key, {
          text,
          measures,
          exports: exportedNames(ctx.file, text),
          small: measures.lines < options.minLines,
        });
      }
      const baseline = baselines.get(key);
      if (baseline === undefined || baseline.small) {
        return; // too small to be worth a model call
      }

      await model.runTools(
        {
          model: modelName,
          effort: config.model.effort,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt({
            file: ctx.file,
            measures: baseline.measures,
            ...(ctx.previousFailure === undefined ? {} : { previousFailure: ctx.previousFailure }),
          }),
          tools: [
            ...readTools(ctx.cwd),
            writeOneFileTool(
              ctx.cwd,
              ctx.file,
              'write_file',
              `Write the whole simplified ${ctx.file}, replacing it.`,
            ),
            checkTypesTool(
              options.typecheckCommand,
              ctx.cwd,
              [ctx.file],
              config.gates.timeoutSeconds,
            ),
            runTestsTool(
              ctx.cwd,
              withTestRunner(options.testCommand, config.testRunner).replaceAll(
                '{file}',
                shellQuote(ctx.file),
              ),
              config.gates.timeoutSeconds,
              `Run the tests related to ${ctx.file}. Finish only when they pass.`,
            ),
            reportBugTool((bug) => {
              ctx.report(bug);
            }, `Record a suspected bug in ${ctx.file}. Keep the current behaviour; this is how a bug gets noticed.`),
          ],
          maxIterations: MAX_ITERATIONS,
          progress: ctx.progress,
        },
        ctx.usage,
      );

      // Checked, not trusted.
      const after = await readFile(path, 'utf8');
      if (normalize(ctx.file, after) === normalize(ctx.file, baseline.text)) {
        // Left unchanged — a valid answer. Formatting-only edits are put back so they never reach a commit.
        await writeFile(path, baseline.text);
        return;
      }
      const problems: string[] = [];
      const changed = exportsChanged(baseline.exports, exportedNames(ctx.file, after));
      if (changed !== undefined) problems.push(changed);
      const simpler = notSimpler(baseline.measures, measure(ctx.file, after));
      if (simpler !== undefined) problems.push(simpler);
      if (problems.length === 0 && /\.tsx?$/.test(ctx.file)) {
        const errors = await typeErrors(
          options.typecheckCommand,
          ctx.cwd,
          [ctx.file],
          config.gates.timeoutSeconds,
        );
        if (errors !== '') problems.push(`type errors:\n${errors}`);
      }
      if (problems.length > 0) {
        throw new Error(problems.join('\n\n'));
      }
    },
  };
}
