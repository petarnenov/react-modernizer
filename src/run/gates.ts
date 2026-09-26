import { spawn } from 'node:child_process';

const OUTPUT_LIMIT = 20_000;

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

function keepTail(text: string): string {
  return text.length <= OUTPUT_LIMIT ? text : `…${text.slice(-OUTPUT_LIMIT)}`;
}

/** Runs one shell command in its own process group, so a timeout stops everything it started. */
function runCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      output = keepTail(output + chunk.toString());
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
      resolve({ ok: false, output: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          output: `${output}\nstopped after the ${String(timeoutSeconds)}s timeout`,
        });
      } else {
        resolve({ ok: code === 0, output });
      }
    });
  });
}

export interface GateCommandsOptions {
  commands: readonly string[];
  cwd: string;
  /** Files handed to `{files}`, relative to `cwd`. */
  files: readonly string[];
  timeoutSeconds: number;
  semaphore: Semaphore;
}

/** Runs the gate commands in order and stops at the first failure. */
export async function runGateCommands(options: GateCommandsOptions): Promise<GateResult> {
  const files = options.files.map(shellQuote).join(' ');
  for (const template of options.commands) {
    const command = template.replaceAll('{files}', files);
    const result = await options.semaphore.use(() =>
      runCommand(command, options.cwd, options.timeoutSeconds),
    );
    if (!result.ok) {
      return { ok: false, gate: template, output: result.output };
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
