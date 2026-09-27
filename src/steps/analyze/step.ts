import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModernizerConfig } from '../../config/schema.js';
import type { ModelClient } from '../../model/client.js';
import { runCommand, shellQuote } from '../../run/gates.js';
import { characterizationTestPath, existingTestPath } from '../characterize-tests/paths.js';
import { readTools, reportBugTool } from '../shared/tools.js';
import { measure } from '../simplify/metrics.js';
import type { Step } from '../step.js';
import { buildPrompt, SYSTEM_PROMPT } from './instructions.js';

const MAX_ITERATIONS = 30;
const LINT_LIMIT = 10_000;
/** The shell's exit codes for a command it could not find (127) or not execute (126). */
const SHELL_CANNOT_RUN = new Set([126, 127]);
/** Output of tools that start but cannot run the linter (npx without the package, missing modules). */
const CANNOT_RUN = /could not determine executable|Cannot find module/i;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** The linter's output for the file, or undefined when it could not run. A linter reporting problems is evidence. */
export async function lintEvidence(
  command: string,
  cwd: string,
  file: string,
  timeoutSeconds: number,
): Promise<string | undefined> {
  const result = await runCommand(
    command.replaceAll('{file}', shellQuote(file)),
    cwd,
    timeoutSeconds,
  );
  const couldNotRun =
    result.code === null ||
    (result.code !== undefined && SHELL_CANNOT_RUN.has(result.code)) ||
    CANNOT_RUN.test(result.output);
  if (!result.ok && (couldNotRun || result.output.trim() === '')) {
    return undefined;
  }
  return result.output.length <= LINT_LIMIT ? result.output : result.output.slice(-LINT_LIMIT);
}

/** Reads each file before it changes and reports bugs and risks. Changes nothing. */
export function createAnalyzeStep(config: ModernizerConfig, model: ModelClient): Step {
  const options = config.steps.analyze;
  const modelName = options.model ?? config.model.default;

  return {
    id: 'analyze',
    allowedChanges: () => [],
    preflight: () => model.check(modelName),
    async run(ctx) {
      const text = await readFile(join(ctx.cwd, ctx.file), 'utf8');
      if (measure(ctx.file, text).lines < options.minLines) {
        return; // too small to be worth a model call
      }
      const tests: string[] = [];
      for (const candidate of [existingTestPath(ctx.file), characterizationTestPath(ctx.file)]) {
        if (await exists(join(ctx.cwd, candidate))) tests.push(candidate);
      }
      await model.runTools(
        {
          model: modelName,
          effort: config.model.effort,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt({
            file: ctx.file,
            tests,
            importers: ctx.importers,
            lint: await lintEvidence(
              options.lintCommand,
              ctx.cwd,
              ctx.file,
              config.gates.timeoutSeconds,
            ),
          }),
          tools: [
            ...readTools(ctx.cwd),
            reportBugTool((bug) => {
              ctx.report(bug);
            }, `Record one finding in ${ctx.file}: its line, severity and reason.`),
          ],
          maxIterations: MAX_ITERATIONS,
          progress: ctx.progress,
          ownFiles: [ctx.file, ...tests],
        },
        ctx.usage,
      );
    },
  };
}
