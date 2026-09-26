import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.js';
import { RateLimiter, type Clock } from '../src/model/rate-limit.js';
import {
  formatDuration,
  PlainProgress,
  TerminalProgress,
  toolDetail,
  type ProgressEvent,
} from '../src/run/progress.js';
import { runModernizer } from '../src/run/runner.js';
import type { Step } from '../src/steps/step.js';
import { tempRepo } from './helpers/repo.js';

describe('toolDetail', () => {
  it('shows the path a tool touches and the line of a finding, nothing else', () => {
    expect(toolDetail('read_file', { path: 'src/api.js' })).toBe('src/api.js');
    expect(toolDetail('report_bug', { line: 12, reason: 'secret reasoning' })).toBe('line 12');
    expect(toolDetail('write_test_file', { content: 'const password = 1;' })).toBeUndefined();
    expect(toolDetail('run_tests', {})).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('reads naturally at every scale', () => {
    expect([450, 6_100, 48_000, 102_000].map(formatDuration)).toEqual([
      '0.5s',
      '6.1s',
      '48s',
      '1m42s',
    ]);
  });
});

describe('RateLimiter', () => {
  it('says how long a caller will wait', async () => {
    let now = 0;
    const clock: Clock = {
      now: () => now,
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    };
    const limiter = new RateLimiter(1, clock);
    const waits: number[] = [];

    await limiter.acquire((ms) => waits.push(ms));
    await limiter.acquire((ms) => waits.push(ms));

    expect(waits).toEqual([60_000]);
  });
});

describe('a run reports its progress', () => {
  it('phases before the first file, then steps, model activity, gates and the result', async () => {
    const root = await tempRepo({ 'src/api.js': 'export const api = 1;\n' });
    const step: Step = {
      id: 'simplify',
      preflight: () => Promise.resolve(),
      run: async (ctx) => {
        ctx.progress?.({ kind: 'model-turn', turn: 1 });
        ctx.progress?.({ kind: 'tool-call', tool: 'read_file', detail: 'src/api.js' });
        await writeFile(join(ctx.cwd, ctx.file), 'export const api = 2;\n');
      },
    };
    const config = parseConfig({
      target: root,
      steps: {
        analyze: { enabled: false },
        'characterize-tests': { enabled: false },
        'class-to-function': { enabled: false },
        'js-to-ts': { enabled: false },
      },
      gates: { commands: ['true'], coverage: { min: 0 } },
    });
    const events: ProgressEvent[] = [];
    const lines: string[] = [];

    await runModernizer({
      config,
      steps: { simplify: step },
      log: (l) => lines.push(l),
      progress: (e) => events.push(e),
    });

    expect(events.map((e) => e.kind)).toEqual([
      'phase',
      'phase',
      'phase',
      'phase',
      'phase',
      'file-start',
      'step-start',
      'model-turn',
      'tool-call',
      'gate-start',
      'gate-end',
      'step-end',
      'file-end',
    ]);
    expect(events.filter((e) => e.kind === 'phase').map((e) => e.text)).toEqual([
      'scanning source and building the import graph',
      'import graph: 1 files, 0 internal imports',
      'checking model access: claude-sonnet-5 (Anthropic)',
      'indexing importers across the project',
      'preparing 1 worktree',
    ]);
    expect(events[5]).toEqual({ kind: 'file-start', file: 'src/api.js', index: 1, total: 1 });
    expect(events[8]).toEqual({
      kind: 'tool-call',
      tool: 'read_file',
      detail: 'src/api.js',
      file: 'src/api.js',
    });
    expect(events[10]).toMatchObject({ kind: 'gate-end', command: 'true', ok: true });
    expect(lines[0]).toMatch(/^✓ src\/api\.js [0-9a-f]{7} \(\d+\.\ds · 0 tokens\)$/);
  });

  it('reports a retry with the first line of the reason', async () => {
    const root = await tempRepo({ 'src/api.js': 'export const api = 1;\n' });
    let n = 0;
    const step: Step = {
      id: 'simplify',
      run: async (ctx) => {
        n++;
        await writeFile(join(ctx.cwd, ctx.file), `export const api = ${String(n + 1)};\n`);
      },
    };
    const config = parseConfig({
      target: root,
      steps: {
        analyze: { enabled: false },
        'characterize-tests': { enabled: false },
        'class-to-function': { enabled: false },
        'js-to-ts': { enabled: false },
      },
      gates: {
        commands: ['grep -q "api = 3" src/api.js || { echo "no three"; exit 1; }'],
        coverage: { min: 0 },
      },
    });
    const events: ProgressEvent[] = [];

    await runModernizer({
      config,
      steps: { simplify: step },
      log: () => undefined,
      progress: (e) => events.push(e),
    });

    const retry = events.find((e) => e.kind === 'retry');
    expect(retry).toMatchObject({ step: 'simplify', attempt: 1 });
    expect(retry?.kind === 'retry' && retry.reason.split('\n')[0]).toMatch(/failed:$/);
    expect(events.filter((e) => e.kind === 'gate-end').map((e) => e.ok)).toEqual([false, true]);
  });
});

const at = new Date(2026, 8, 26, 21, 5, 9);

describe('PlainProgress', () => {
  it('writes every event as a timestamped line without control codes', () => {
    let out = '';
    const plain = new PlainProgress(
      (t) => (out += t),
      () => at,
    );

    plain.event({ kind: 'phase', text: 'preparing 1 worktree' });
    plain.event({ kind: 'file-start', file: 'src/a/Card.jsx', index: 2, total: 7 });
    plain.event({ kind: 'step-start', file: 'src/a/Card.jsx', step: 'analyze', attempt: 0 });
    plain.event({ kind: 'model-turn', file: 'src/a/Card.jsx', turn: 3 });
    plain.event({
      kind: 'tool-call',
      file: 'src/a/Card.jsx',
      tool: 'read_file',
      detail: 'src/api.js',
    });
    plain.event({
      kind: 'gate-end',
      file: 'src/a/Card.jsx',
      command: 'npx eslint {files}',
      ok: false,
      ms: 6100,
    });
    plain.event({
      kind: 'step-end',
      file: 'src/a/Card.jsx',
      step: 'analyze',
      ms: 48_000,
      findings: 2,
      changed: false,
    });
    plain.line('✓ src/a/Card.jsx abc1234');

    expect(out.split('\n')).toEqual([
      '21:05:09 · preparing 1 worktree',
      '21:05:09 [2/7] Card.jsx · start',
      '21:05:09 [2/7] Card.jsx · analyze attempt 1',
      '21:05:09 [2/7] Card.jsx · turn 3',
      '21:05:09 [2/7] Card.jsx · read_file src/api.js',
      '21:05:09 [2/7] Card.jsx · gate npx eslint {files} ✗ 6.1s',
      '21:05:09 [2/7] Card.jsx · analyze ✓ unchanged · 2 findings (48s)',
      '21:05:09 ✓ src/a/Card.jsx abc1234',
      '',
    ]);
    expect(out).not.toContain('\x1b');
  });
});

describe('TerminalProgress', () => {
  it('keeps a live line per file below the permanent lines, and clears it at the end', () => {
    const writes: string[] = [];
    let now = 0;
    const terminal = new TerminalProgress(
      (t) => writes.push(t),
      () => 60,
      () => now,
      60_000,
    );

    terminal.event({ kind: 'file-start', file: 'src/Card.jsx', index: 2, total: 7 });
    terminal.event({ kind: 'step-start', file: 'src/Card.jsx', step: 'analyze', attempt: 0 });
    now = 37_000;
    terminal.event({
      kind: 'tool-call',
      file: 'src/Card.jsx',
      tool: 'read_file',
      detail: 'src/api.js',
    });

    expect(writes.at(-1)).toBe(
      '\x1b[1A\r\x1b[J⠋ [2/7] Card.jsx · analyze · read_file src/api.js · 37s\n',
    );

    terminal.line('✓ src/Card.jsx abc1234');
    expect(writes.at(-1)).toBe(
      '\x1b[1A\r\x1b[J✓ src/Card.jsx abc1234\n⠋ [2/7] Card.jsx · analyze · read_file src/api.js · 37s\n',
    );

    terminal.event({ kind: 'file-end', file: 'src/Card.jsx' });
    terminal.stop();
    expect(writes.at(-1)).toBe('\x1b[1A\r\x1b[J');
  });

  it('cuts a status line to the terminal width', () => {
    const writes: string[] = [];
    const terminal = new TerminalProgress(
      (t) => writes.push(t),
      () => 30,
      () => 0,
      60_000,
    );

    terminal.event({
      kind: 'file-start',
      file: 'src/AVeryLongComponentName.jsx',
      index: 1,
      total: 1,
    });

    const line = writes.at(-1)?.split('\n')[0] ?? '';
    expect(line.length).toBeLessThanOrEqual(29);
    expect(line.endsWith('…')).toBe(true);
    terminal.stop();
  });
});
