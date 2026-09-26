#!/usr/bin/env node
import { main } from './cli.js';

process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  terminal:
    process.stdout.isTTY &&
    process.env.TERM !== 'dumb' &&
    (process.env.NO_COLOR === undefined || process.env.NO_COLOR === ''),
});
