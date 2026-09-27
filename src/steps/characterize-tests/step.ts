import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { withTestRunner } from '../../config/commands.js';
import type { ModernizerConfig } from '../../config/schema.js';
import type { ModelClient } from '../../model/client.js';
import type { Step } from '../step.js';
import { buildPrompt, SYSTEM_PROMPT } from './instructions.js';
import { characterizationTestPath, existingTestPath } from './paths.js';
import { createTools } from './tools.js';

/** Enough turns to read, write, run and fix a few times; the token budget is the real limit. */
const MAX_ITERATIONS = 40;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Pins a file's current behaviour with tests before anything changes it. */
export function createCharacterizeTestsStep(config: ModernizerConfig, model: ModelClient): Step {
  const options = config.steps['characterize-tests'];
  const modelName = options.model ?? config.model.default;

  return {
    id: 'characterize-tests',
    allowedChanges: (file) => [characterizationTestPath(file)],
    producesTests: (file) => [characterizationTestPath(file)],
    preflight: () => model.check(modelName),
    async run(ctx) {
      const testPath = characterizationTestPath(ctx.file);
      const existing = existingTestPath(ctx.file);
      await model.runTools(
        {
          model: modelName,
          effort: config.model.effort,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt({
            file: ctx.file,
            testPath,
            helpers: options.helpers,
            coverageMin: config.gates.coverage.min,
            ...((await exists(join(ctx.cwd, existing))) ? { existingTest: existing } : {}),
            ...(ctx.previousFailure === undefined ? {} : { previousFailure: ctx.previousFailure }),
          }),
          tools: createTools({
            cwd: ctx.cwd,
            testPath,
            testCommand: withTestRunner(options.testCommand, config.testRunner),
            timeoutSeconds: config.gates.timeoutSeconds,
            report: (bug) => {
              ctx.report(bug);
            },
          }),
          maxIterations: MAX_ITERATIONS,
          progress: ctx.progress,
          ownFiles: [ctx.file, testPath],
        },
        ctx.usage,
      );
      if (!(await exists(join(ctx.cwd, testPath)))) {
        throw new Error(`the model finished without writing ${testPath}`);
      }
    },
  };
}
