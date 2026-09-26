import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import type { GateCommand } from '../config/schema.js';
import { newErrors, parseErrors, type ErrorCounts } from './baseline.js';

const OUTPUT_LIMIT = 20_000;
/** For output that is parsed, not shown: the whole type check of a large project fits easily. */
const FULL_OUTPUT_LIMIT = 64 * 1024 * 1024;

/** Limits how many gate commands run at once across all workers. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit must be a positive integer, got ${String(limit)}`);
    }
  }

  async use<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export type GateResult = { ok: true } | { ok: false; gate: string; output: string };

/** Quotes one argument for `sh`. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function keepTail(text: string, limit = OUTPUT_LIMIT): string {
  return text.length <= limit ? text : `…${text.slice(-limit)}`;
}

/**
 * Runs one shell command in its own process group, so a timeout stops everything it started. Output is capped to
 * its last 20,000 characters, or kept whole (up to 64 MB) with `full` for output that is parsed.
 */
export function runCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number,
  { full = false }: { full?: boolean } = {},
): Promise<{ ok: boolean; output: string; code?: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      output = keepTail(output + chunk.toString(), full ? FULL_OUTPUT_LIMIT : OUTPUT_LIMIT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }, timeoutSeconds * 1000);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: error.message, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          output: `${output}\nstopped after the ${String(timeoutSeconds)}s timeout`,
        });
      } else {
        resolve({ ok: code === 0, output, code });
      }
    });
  });
}

export interface GateCommandsOptions {
  commands: readonly GateCommand[];
  cwd: string;
  /** Files handed to `{files}`, relative to `cwd`. */
  files: readonly string[];
  /** The worker's cache directory, handed to `{cache}`. */
  cache: string;
  timeoutSeconds: number;
  semaphore: Semaphore;
  /** The baseline of a `newErrorsOnly` command, by its configured text. */
  baseline?: ((command: GateCommand) => ErrorCounts | undefined) | undefined;
  /** A changed file's path in the baseline; a renamed file keeps its errors. */
  baseName?: ((file: string) => string) | undefined;
  /** Told when each command starts, and how it ended. */
  onGate?: ((event: { command: string; ok?: boolean; ms?: number }) => void) | undefined;
}

/** A configured command made concrete: `{files}` quoted, `{cache}` the worker's directory. */
export function expandCommand(template: string, files: readonly string[], cache: string): string {
  return template
    .replaceAll('{files}', files.map(shellQuote).join(' '))
    .replaceAll('{cache}', shellQuote(cache));
}

/**
 * Judges one run of a command: plain commands by their exit code; `newErrorsOnly` commands by the errors they report
 * beyond the baseline. A failure that reports no error in the expected format — a crash — fails as a plain command.
 */
export function judge(
  command: GateCommand,
  result: { ok: boolean; output: string },
  cwds: readonly string[],
  baseline: ErrorCounts | undefined,
  baseName?: (file: string) => string,
): GateResult {
  if (command.newErrorsOnly === undefined || baseline === undefined) {
    return result.ok
      ? { ok: true }
      : { ok: false, gate: command.run, output: keepTail(result.output) };
  }
  const errors = parseErrors(command.newErrorsOnly, result.output, cwds);
  if (!result.ok && errors.length === 0) {
    return { ok: false, gate: command.run, output: keepTail(result.output) };
  }
  const fresh = newErrors(errors, baseline, baseName);
  return fresh.length === 0
    ? { ok: true }
    : {
        ok: false,
        gate: command.run,
        output: keepTail(
          `${String(fresh.length)} new error(s); errors that were there before are not shown:\n${fresh.map((e) => e.text).join('\n')}`,
        ),
      };
}

/** Runs the gate commands in order and stops at the first failure. */
export async function runGateCommands(options: GateCommandsOptions): Promise<GateResult> {
  const cwds = [options.cwd, await realpath(options.cwd).catch(() => options.cwd)];
  for (const command of options.commands) {
    const expanded = expandCommand(command.run, options.files, options.cache);
    const baseline = command.newErrorsOnly === undefined ? undefined : options.baseline?.(command);
    const result = await options.semaphore.use(async () => {
      options.onGate?.({ command: command.run });
      const started = Date.now();
      const ran = await runCommand(expanded, options.cwd, options.timeoutSeconds, {
        full: baseline !== undefined,
      });
      const judged = judge(command, ran, cwds, baseline, options.baseName);
      options.onGate?.({ command: command.run, ok: judged.ok, ms: Date.now() - started });
      return judged;
    });
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

/**
 * Finds forbidden patterns on the lines a diff adds. Takes a unified diff (as `git diff -U0`); only `+` lines count,
 * so a pattern already present before the change never fails the gate.
 */
export function findForbidden(diff: string, patterns: readonly string[]): GateResult {
  let file = '';
  const hits: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : line.slice(4);
      continue;
    }
    if (!line.startsWith('+')) {
      continue;
    }
    const added = line.slice(1);
    for (const pattern of patterns) {
      if (added.includes(pattern)) {
        hits.push(`${file}: "${pattern}" in: ${added.trim()}`);
      }
    }
  }
  return hits.length === 0
    ? { ok: true }
    : { ok: false, gate: 'forbidden patterns', output: hits.join('\n') };
}
