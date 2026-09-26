import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { applyOverrides, ConfigError, loadConfig } from './config/load.js';
import { STEP_IDS } from './config/schema.js';
import { buildGraph } from './graph/build.js';
import { TargetError } from './graph/discover.js';
import { createPlan, renderPlan } from './plan.js';
import { RepositoryError } from './run/git.js';
import { runModernizer, StepsMissingError } from './run/runner.js';
import { StateError } from './run/state.js';
import { describeStatus } from './run/status.js';
import { builtInSteps, type StepRegistry } from './steps/step.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return n;
}

function createProgram(io: Io, setExit: (code: number) => void, steps: StepRegistry): Command {
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
      'Process the codebase file by file; accepted files are committed to the run branch',
    )
    .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
    .option('-w, --workers <n>', 'agents running at once (overrides the file)', positiveInt)
    .option('--fresh', 'discard the saved state and process every file again')
    .action(async (path: string, options: { workers?: number; fresh?: boolean }) => {
      const config = applyOverrides(await loadConfig(path), options);
      const summary = await runModernizer({
        config,
        steps,
        fresh: options.fresh === true,
        log: (line) => {
          io.stdout(`${line}\n`);
        },
      });
      setExit(summary.stopped ? 3 : 0);
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
  steps: StepRegistry = builtInSteps,
): Promise<number> {
  let exitCode = 0;
  try {
    await createProgram(io, (code) => (exitCode = code), steps).parseAsync([...argv], {
      from: 'user',
    });
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
      error instanceof StateError
    ) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
