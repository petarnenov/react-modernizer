#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { applyOverrides, ConfigError, loadConfig } from './config/load.js';
import { STEP_IDS } from './config/schema.js';

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return n;
}

const program = new Command()
  .name('react-modernizer')
  .description('Modernize a React codebase file by file: tests, class→function, JS→TS, simplify.');

program
  .command('check-config')
  .description('Validate a config file and print it with every default filled in')
  .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
  .option('-w, --workers <n>', 'agents running at once (overrides the file)', positiveInt)
  .action(async (path: string, options: { workers?: number }) => {
    const config = applyOverrides(await loadConfig(path), options);
    const enabled = STEP_IDS.filter((id) => config.steps[id].enabled);
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    process.stderr.write(
      `OK — ${String(config.concurrency.workers)} worker(s), steps: ${enabled.join(' → ')}\n`,
    );
  });

program
  .command('run')
  .description('Process the codebase (not implemented yet)')
  .argument('[config]', 'path to the config file', 'modernizer.config.yaml')
  .option('-w, --workers <n>', 'agents running at once (overrides the file)', positiveInt)
  .action(() => {
    process.stderr.write('run is not implemented yet — see docs/design.md for the plan.\n');
    process.exitCode = 2;
  });

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
