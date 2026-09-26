import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCommand, shellQuote, type GateResult, type Semaphore } from './gates.js';

export interface LineCoverage {
  /** Percentage of lines with a statement that ran, one decimal. */
  percent: number;
  /** Lines with statements, none of which ran. */
  uncovered: number[];
}

interface FileReport {
  statementMap?: Record<string, { start: { line: number } }>;
  s?: Record<string, number>;
}

/**
 * Line coverage of one file from Jest's `coverage-final.json`, by Istanbul's rule: a line counts when a statement
 * starts on it, and is covered when one of those statements ran. A file missing from the report was never loaded: 0%.
 */
export function lineCoverage(
  report: Record<string, FileReport>,
  /** The file's absolute path, and its real path if different — Jest reports whichever it resolved. */
  paths: readonly string[],
): LineCoverage {
  const entry = paths.map((p) => report[p]).find((e) => e !== undefined);
  if (entry === undefined) {
    return { percent: 0, uncovered: [] };
  }
  const lines = new Map<number, number>();
  for (const [id, location] of Object.entries(entry.statementMap ?? {})) {
    const line = location.start.line;
    lines.set(line, Math.max(lines.get(line) ?? 0, entry.s?.[id] ?? 0));
  }
  if (lines.size === 0) {
    return { percent: 100, uncovered: [] };
  }
  const uncovered = [...lines]
    .filter(([, hits]) => hits === 0)
    .map(([line]) => line)
    .sort((a, b) => a - b);
  const percent = Math.round(((lines.size - uncovered.length) / lines.size) * 1000) / 10;
  return { percent, uncovered };
}

/** `[12, 13, 14, 30]` → `12–14, 30`. */
export function formatRanges(lines: readonly number[]): string {
  const ranges: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  for (const line of [...lines, Number.NaN]) {
    if (previous !== undefined && line === previous + 1) {
      previous = line;
      continue;
    }
    if (start !== undefined && previous !== undefined) {
      ranges.push(start === previous ? String(start) : `${String(start)}–${String(previous)}`);
    }
    start = line;
    previous = line;
  }
  return ranges.join(', ');
}

export interface CoverageGateOptions {
  testRunner: string;
  /** The target's directory in the worktree. */
  cwd: string;
  /** The file whose coverage counts, relative to `cwd`. */
  file: string;
  /** Its tests, relative to `cwd`. */
  tests: readonly string[];
  min: number;
  timeoutSeconds: number;
  semaphore: Semaphore;
}

/** Runs the tests with coverage for the file only and fails below the minimum, naming the uncovered lines. */
export async function coverageGate(options: CoverageGateOptions): Promise<GateResult> {
  const directory = await mkdtemp(join(tmpdir(), 'modernizer-coverage-'));
  try {
    const command = [
      options.testRunner,
      '--coverage',
      '--coverageReporters=json',
      `--coverageDirectory=${shellQuote(directory)}`,
      `--collectCoverageFrom=${shellQuote(options.file)}`,
      ...options.tests.map(shellQuote),
    ].join(' ');
    const run = await options.semaphore.use(() =>
      runCommand(command, options.cwd, options.timeoutSeconds),
    );
    if (!run.ok) {
      return { ok: false, gate: 'coverage (tests failed)', output: run.output };
    }
    const report = JSON.parse(
      await readFile(join(directory, 'coverage-final.json'), 'utf8').catch(() => '{}'),
    ) as Record<string, FileReport>;
    const absolute = resolve(options.cwd, options.file);
    const real = await realpath(absolute).catch(() => absolute);
    const { percent, uncovered } = lineCoverage(report, [absolute, real]);
    if (percent >= options.min) {
      return { ok: true };
    }
    const lines =
      uncovered.length === 0
        ? 'the tests never load the file'
        : `uncovered lines: ${formatRanges(uncovered)}`;
    return {
      ok: false,
      gate: 'coverage',
      output: `line coverage of ${options.file} is ${String(percent)}% (minimum ${String(options.min)}%); ${lines}`,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
