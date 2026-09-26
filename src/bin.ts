#!/usr/bin/env node
import { main } from './cli.js';
import { pickInTerminal } from './cli/pick.js';

const terminal =
  process.stdout.isTTY &&
  process.env.TERM !== 'dumb' &&
  (process.env.NO_COLOR === undefined || process.env.NO_COLOR === '');

process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  terminal,
  // The picker reads keys, so it needs a terminal on both sides.
  ...(terminal && process.stdin.isTTY
    ? {
        pickModel: (models, current, title) =>
          pickInTerminal(process.stdin, (t) => process.stdout.write(t), models, current, title),
      }
    : {}),
});
