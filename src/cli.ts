import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { posix } from 'node:path';
import { applyOverrides, ConfigError, loadConfig } from './config/load.js';
import { STEP_IDS, type ModernizerConfig } from './config/schema.js';
import { buildGraph } from './graph/build.js';
import { TargetError } from './graph/discover.js';
import { createPlan, renderPlan } from './plan.js';
import { ModelAccessError, type ModelClient, type ModelInfo } from './model/client.js';
import { RepositoryError } from './run/git.js';
import { PlainProgress, TerminalProgress } from './run/progress.js';
import { runModernizer, StepsMissingError, type FileSelection } from './run/runner.js';
import { StateError } from './run/state.js';
import { describeStatus } from './run/status.js';
import { createBuiltInSteps, createModelClient } from './steps/registry.js';
import { describeModel } from './cli/pick.js';
import type { StepRegistry } from './steps/step.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** A live status display is possible: stdout is an interactive terminal. */
  terminal?: boolean;
  /** Lets the user choose one of `models`; undefined when cancelled. Absent without an interactive terminal. */
  pickModel?: (
    models: readonly ModelInfo[],
    current: string,
    title: string,
  ) => Promise<string | undefined>;
}

type ClientFor = (config: ModernizerConfig) => ModelClient;

/** Where the models come from, for the picker's title. */
function providerLabel(config: ModernizerConfig): string {
  return config.model.provider === 'ollama' ? `ollama · ${config.model.baseUrl}` : 'anthropic';
}

/** `--files`: a positive count, `all`, or the path of one file relative to the target. */
export function fileSelection(value: string): FileSelection {
  if (value === 'all') return { kind: 'all' };
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    if (n < 1) throw new InvalidArgumentError('must be a positive integer, all, or a file path');
    return { kind: 'count', n };
  }
  return { kind: 'path', file: posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '') };
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return n;
}

type StepsFor = (config: ModernizerConfig) => StepRegistry;

interface RunCommandOptions {
  workers?: number;
  files?: FileSelection;
  fresh?: boolean;
  model?: string;
  pickModel?: boolean;
}

function createProgram(
  io: Io,
  setExit: (code: number) => void,
  stepsFor: StepsFor,
  clientFor: ClientFor,
): Command {
  const program = new Command()
    .name('react-modernizer')
    .description('Modernize a React codebase file by file: tests, class→function, JS→TS, simplify.')
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  program
    .command('check-config')
    .description('Validate a config file and print it with every default filled in')
    .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
    .option('-w, --workers <n>', 'agents running at once (overrides the file)', positiveInt)
    .action(async (path: string, options: { workers?: number }) => {
      const config = applyOverrides(await loadConfig(path), options);
      const enabled = STEP_IDS.filter((id) => config.steps[id].enabled);
      io.stdout(`${JSON.stringify(config, null, 2)}\n`);
      io.stderr(
        `OK — ${String(config.concurrency.workers)} worker(s), steps: ${enabled.join(' → ')}\n`,
      );
    });

  program
    .command('plan')
    .description('Show the processing order and import graph statistics; changes nothing')
    .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
    .option('--json', 'print one JSON document instead of text')
    .action(async (path: string, options: { json?: boolean }) => {
      const config = await loadConfig(path);
      const plan = createPlan(config.target, await buildGraph(config.target, config.source));
      io.stdout(options.json === true ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan));
    });

  program
    .command('run')
    .description(
      'Process the codebase file by file; accepted files are committed to <current branch>-modernized',
    )
    .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
    .option('-w, --workers <n>', 'agents running at once (overrides the file)', positiveInt)
    .option(
      '--files <n|all|path>',
      'how many files to process: a number (default 1), all, or the path of one file',
      fileSelection,
    )
    .option('--fresh', 'discard the saved state and process every file again')
    .option('-m, --model <name>', 'model for this run (overrides model.default)')
    .option('--pick-model', "choose the model from the provider's current list")
    .action(async (path: string, options: RunCommandOptions) => {
      let config = applyOverrides(await loadConfig(path), options);
      if (options.pickModel === true) {
        if (io.terminal !== true || io.pickModel === undefined) {
          throw new ConfigError(
            '--pick-model needs an interactive terminal; use --model <name> instead',
          );
        }
        const models = await clientFor(config).listModels();
        const chosen = await io.pickModel(
          models,
          config.model.default,
          `Model (${providerLabel(config)})`,
        );
        if (chosen === undefined) {
          io.stderr('cancelled\n');
          setExit(130);
          return;
        }
        config = applyOverrides(config, { model: chosen });
      }
      if (options.model !== undefined || options.pickModel === true) {
        const own = STEP_IDS.filter(
          (id) => config.steps[id].enabled && config.steps[id].model !== undefined,
        );
        io.stdout(`model: ${config.model.default}\n`);
        for (const id of own) {
          io.stdout(`note: ${id} keeps its own model ${String(config.steps[id].model)}\n`);
        }
      }
      const renderer =
        io.terminal === true ? new TerminalProgress(io.stdout) : new PlainProgress(io.stdout);
      try {
        const summary = await runModernizer({
          config,
          steps: stepsFor(config),
          fresh: options.fresh === true,
          files: options.files ?? { kind: 'count', n: 1 },
          log: (line) => {
            renderer.line(line);
          },
          progress: (event) => {
            renderer.event(event);
          },
        });
        setExit(summary.stopped ? 3 : 0);
      } finally {
        renderer.stop();
      }
    });

  program
    .command('models')
    .description('List the models the configured provider offers now; runs nothing')
    .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
    .option('--json', 'print one JSON document instead of text')
    .action(async (path: string, options: { json?: boolean }) => {
      const config = await loadConfig(path);
      const models = await clientFor(config).listModels();
      if (options.json === true) {
        io.stdout(`${JSON.stringify(models, null, 2)}\n`);
        return;
      }
      const width = Math.max(0, ...models.map((m) => m.name.length));
      io.stdout(`${String(models.length)} models (${providerLabel(config)}), newest first:\n`);
      for (const m of models) {
        const marker = m.name === config.model.default ? '*' : ' ';
        const facts = describeModel(m);
        io.stdout(`${marker} ${facts === '' ? m.name : `${m.name.padEnd(width)}  ${facts}`}\n`);
      }
    });

  program
    .command('status')
    .description('Summarise the saved state of the run; runs nothing')
    .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
    .action(async (path: string) => {
      io.stdout(await describeStatus(await loadConfig(path)));
    });

  return program;
}

/** Runs the CLI and returns its exit code. `argv` excludes the node binary and script path. */
export async function main(
  argv: readonly string[],
  io: Io,
  steps: StepRegistry | StepsFor = createBuiltInSteps,
  clientFor: ClientFor = createModelClient,
): Promise<number> {
  let exitCode = 0;
  try {
    const stepsFor: StepsFor = typeof steps === 'function' ? steps : () => steps;
    await createProgram(io, (code) => (exitCode = code), stepsFor, clientFor).parseAsync(
      [...argv],
      {
        from: 'user',
      },
    );
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    if (
      error instanceof ConfigError ||
      error instanceof TargetError ||
      error instanceof RepositoryError ||
      error instanceof StepsMissingError ||
      error instanceof StateError ||
      error instanceof ModelAccessError
    ) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
