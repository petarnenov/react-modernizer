import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { applyOverrides, ConfigError, loadConfig } from './config/load.js';
import { STEP_IDS } from './config/schema.js';
import { buildGraph } from './graph/build.js';
import { TargetError } from './graph/discover.js';
import { createPlan, renderPlan } from './plan.js';

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

function createProgram(io: Io, setExit: (code: number) => void): Command {
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
    .description('Process the codebase (not implemented yet)')
    .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
    .option('-w, --workers <n>', 'agents running at once (overrides the file)', positiveInt)
    .action(() => {
      io.stderr('run is not implemented yet — see docs/design.md for the plan.\n');
      setExit(2);
    });

  return program;
}

/** Runs the CLI and returns its exit code. `argv` excludes the node binary and script path. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  let exitCode = 0;
  try {
    await createProgram(io, (code) => (exitCode = code)).parseAsync([...argv], { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    if (error instanceof ConfigError || error instanceof TargetError) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
