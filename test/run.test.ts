import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSelection, main } from '../src/cli.js';
import { parseConfig } from '../src/config/load.js';
import type { ModernizerConfig, StepId } from '../src/config/schema.js';
import { Semaphore } from '../src/run/gates.js';
import { openRepository } from '../src/run/git.js';
import { runModernizer, statePath, StepsMissingError, type RunOptions } from '../src/run/runner.js';
import { emptyState, loadState, saveState } from '../src/run/state.js';
import { processFile, type FileJob } from '../src/run/transaction.js';
import { createWorktrees, runDirectory, worktreeDirectory } from '../src/run/workspace.js';
import type { Step, StepContext, StepRegistry } from '../src/steps/step.js';
import { sh, tempRepo } from './helpers/repo.js';

const APP = {
  'src/api.js': 'export const api = 1;\n',
  'src/Card.jsx': "import { api } from './api';\nexport const Card = () => api;\n",
  'src/Page.jsx': "import { Card } from './Card';\nexport const Page = () => Card;\n",
};

/** A step that appends a marker; `behaviour` decides what it writes on each attempt. */
function fakeStep(
  id: StepId,
  behaviour: (ctx: StepContext) => string | Error = () => `// ${id}\n`,
  calls: StepContext[] = [],
): Step {
  return {
    id,
    async run(ctx) {
      calls.push(ctx);
      const out = behaviour(ctx);
      if (out instanceof Error) throw out;
      if (out !== '') await appendFile(join(ctx.cwd, ctx.file), out);
    },
  };
}

function configFor(root: string, overrides: Record<string, unknown> = {}): ModernizerConfig {
  return parseConfig({
    target: root,
    steps: {
      analyze: { enabled: false },
      'characterize-tests': { enabled: false },
      'class-to-function': { enabled: false },
      'js-to-ts': { enabled: false },
      simplify: { enabled: true },
    },
    gates: { commands: ['! grep -q BROKEN {files}'], forbid: [': any'] },
    retry: { perStep: 2 },
    ...overrides,
  });
}

const quiet = () => undefined;

describe('state', () => {
  it('round-trips and leaves no temporary file behind', async () => {
    const root = await tempRepo({ 'a.js': '' });
    const path = join(root, '.git', 'modernizer', 'state.json');
    const state = emptyState('b', 'HEAD');
    state.files['a.js'] = { status: 'done', attempts: 1, updatedAt: 'now' };
    await saveState(path, state);

    expect(await loadState(path)).toEqual(state);
    expect(await readdir(join(root, '.git', 'modernizer'))).toEqual(['state.json']);
  });
});

describe('processFile', () => {
  async function job(steps: Step[], files: Record<string, string> = APP): Promise<FileJob> {
    const root = await tempRepo(files);
    const repo = await openRepository(root);
    const base = sh(root, 'rev-parse', 'HEAD');
    const [worktree] = await createWorktrees(
      repo,
      worktreeDirectory(repo, 'r'),
      1,
      base,
      join(root, 'nm'),
    );
    if (worktree === undefined) throw new Error('worktree missing');
    return {
      file: 'src/Card.jsx',
      worktree,
      base,
      steps,
      gates: {
        commands: [{ run: '! grep -q BROKEN {files}' }],
        forbid: [': any'],
        timeoutSeconds: 30,
        semaphore: new Semaphore(1),
        testRunner: 'true',
        coverageMin: 0,
        protectTestsFrom: null,
      },
      retries: 2,
    };
  }

  it('commits a change that passes the gates', async () => {
    const result = await processFile(await job([fakeStep('simplify')]));

    expect(result).toMatchObject({ status: 'done', attempts: 1, steps: ['simplify'] });
    expect(result.status === 'done' && result.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('retries a step with the gate failure and commits once', async () => {
    const calls: StepContext[] = [];
    const step = fakeStep(
      'simplify',
      (ctx) => (ctx.previousFailure === undefined ? 'BROKEN\n' : ''),
      calls,
    );
    const j = await job([step]);
    // The retry must fix its own previous output, so it removes the marker.
    const fixing: Step = {
      id: 'simplify',
      async run(ctx) {
        await step.run(ctx);
        if (ctx.previousFailure !== undefined) {
          const path = join(ctx.cwd, ctx.file);
          await writeFile(path, (await readFile(path, 'utf8')).replace('BROKEN\n', '// fixed\n'));
        }
      },
    };
    const result = await processFile({ ...j, steps: [fixing] });

    expect(result).toMatchObject({ status: 'done', attempts: 2 });
    expect(calls[1]?.previousFailure).toContain('grep -q BROKEN');
    expect(calls[1]?.attempt).toBe(1);
  });

  it('reverts and fails after the retries are used up', async () => {
    const j = await job([fakeStep('simplify', () => 'BROKEN\n')]);
    const result = await processFile(j);

    expect(result).toMatchObject({ status: 'failed', attempts: 3 });
    expect(result.status === 'failed' && result.reason).toContain('simplify:');
    expect(await readFile(join(j.worktree.cwd, 'src/Card.jsx'), 'utf8')).toBe(APP['src/Card.jsx']);
  });

  it('ends the step when an attempt leaves the rejected tree unchanged', async () => {
    const calls: StepContext[] = [];
    const gates: string[] = [];
    // Writes BROKEN once, then only reads.
    const j = await job([
      fakeStep('simplify', (ctx) => (ctx.attempt === 0 ? 'BROKEN\n' : ''), calls),
    ]);
    const result = await processFile({
      ...j,
      progress: (e) => {
        if (e.kind === 'gate-start') gates.push(e.command);
      },
    });

    expect(calls).toHaveLength(2);
    expect(gates).toHaveLength(1);
    expect(result).toMatchObject({ status: 'failed', attempts: 2 });
    expect(result.status === 'failed' && result.reason).toBe(
      `simplify: attempt 2 changed nothing since the gates rejected it:\n${calls[1]?.previousFailure ?? ''}`,
    );
    expect(calls[1]?.previousFailure).toContain('grep -q BROKEN');
  });

  it('fails on a forbidden pattern the step adds', async () => {
    const result = await processFile(
      await job([fakeStep('simplify', () => 'const x: any = 1;\n')]),
    );

    expect(result.status === 'failed' && result.reason).toContain('forbidden patterns');
  });

  it('treats a throwing step as a failed attempt', async () => {
    const result = await processFile(
      await job([fakeStep('simplify', () => new Error('model down'))]),
    );

    expect(result.status === 'failed' && result.reason).toContain('simplify threw: model down');
  });

  it('puts back files a step may not change and fails the attempt', async () => {
    const j = await job([]);
    const sneaky: Step = {
      id: 'simplify',
      allowedChanges: (file) => [file.replace('.jsx', '.characterization.test.jsx')],
      async run(ctx) {
        await writeFile(join(ctx.cwd, 'src/Card.characterization.test.jsx'), '// ok\n');
        await writeFile(join(ctx.cwd, 'src/api.js'), 'tampered\n');
        await writeFile(join(ctx.cwd, 'src/new.js'), 'new\n');
      },
    };
    const result = await processFile({ ...j, steps: [sneaky], retries: 0 });

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toContain(
      'changed files it may not change (put back): src/api.js, src/new.js',
    );
  });

  it('counts tokens of failed attempts and stops retrying when the budget is spent', async () => {
    const calls: StepContext[] = [];
    const spender: Step = {
      id: 'simplify',
      async run(ctx) {
        calls.push(ctx);
        ctx.usage.add({ input_tokens: 600, output_tokens: 100 });
        ctx.report({ line: 2, reason: 'looks off by one' });
        await appendFile(join(ctx.cwd, ctx.file), 'BROKEN\n');
      },
    };
    const result = await processFile({ ...(await job([])), steps: [spender], tokenBudget: 1000 });

    expect(result.status).toBe('failed');
    expect(calls).toHaveLength(2); // the budget, not the three retries, ended it
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 200 });
    expect(result.bugs).toHaveLength(2);
  });

  it('records an unchanged file as done without a commit', async () => {
    const result = await processFile(await job([fakeStep('simplify', () => '')]));

    expect(result).toEqual({
      status: 'done',
      attempts: 1,
      steps: ['simplify'],
      usage: { inputTokens: 0, outputTokens: 0 },
      bugs: [],
    });
  });
});

describe('runModernizer', () => {
  const steps: StepRegistry = { simplify: fakeStep('simplify') };

  it('refuses to start while an enabled step has no implementation', async () => {
    const root = await tempRepo(APP);

    await expect(
      runModernizer({ config: parseConfig({ target: root }), steps: {}, log: quiet }),
    ).rejects.toThrow(StepsMissingError);
  });

  it('processes no file when a step preflight fails', async () => {
    const root = await tempRepo(APP);
    const calls: StepContext[] = [];
    const step: Step = {
      ...fakeStep('simplify', () => '', calls),
      preflight: () => Promise.reject(new Error('no credentials')),
    };

    await expect(
      runModernizer({ config: configFor(root), steps: { simplify: step }, log: quiet }),
    ).rejects.toThrow('no credentials');
    expect(calls).toHaveLength(0);
  });

  it('commits one file per commit on the modernized branch, checked out, leaving main alone', async () => {
    const root = await tempRepo(APP);
    await writeFile(join(root, 'notes.txt'), 'untracked user file\n');
    const main = sh(root, 'rev-parse', 'main');

    const summary = await runModernizer({ config: configFor(root), steps, log: () => undefined });

    expect(summary).toMatchObject({
      branch: 'main-modernized',
      total: 3,
      done: 3,
      failed: 0,
      remaining: 0,
      stopped: false,
    });
    expect(sh(root, 'log', '--format=%s', 'main..main-modernized').split('\n')).toEqual([
      'modernize: src/Page.jsx',
      'modernize: src/Card.jsx',
      'modernize: src/api.js',
    ]);
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main-modernized');
    expect(await readFile(join(root, 'src/api.js'), 'utf8')).toBe(
      sh(root, 'show', 'main-modernized:src/api.js') + '\n',
    );
    expect(sh(root, 'status', '--porcelain')).toBe('?? notes.txt');
    expect(sh(root, 'rev-parse', 'main')).toBe(main);
    expect(sh(root, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('refuses uncommitted tracked changes and a detached HEAD, creating no branch', async () => {
    const root = await tempRepo(APP);
    await writeFile(join(root, 'src/api.js'), 'uncommitted user work\n');
    const run = () => runModernizer({ config: configFor(root), steps, log: () => undefined });

    await expect(run()).rejects.toThrow(/uncommitted changes to tracked files:\n {2}src\/api\.js/);
    expect(await readFile(join(root, 'src/api.js'), 'utf8')).toBe('uncommitted user work\n');
    sh(root, 'checkout', '--quiet', '--', 'src/api.js');
    sh(root, 'checkout', '--quiet', '--detach');
    await expect(run()).rejects.toThrow('HEAD is detached');
    expect(sh(root, 'branch', '--list', 'main-modernized')).toBe('');
  });

  it('continues on the modernized branch and says when main moved on', async () => {
    const root = await tempRepo(APP);
    const lines: string[] = [];
    const run = () => runModernizer({ config: configFor(root), steps, log: (l) => lines.push(l) });
    await run();
    sh(root, 'checkout', '--quiet', 'main');
    await writeFile(join(root, 'late.txt'), 'x\n');
    sh(root, 'add', 'late.txt');
    sh(root, 'commit', '--quiet', '-m', 'late');

    const summary = await run();

    expect(summary).toMatchObject({ branch: 'main-modernized', done: 3 });
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main-modernized');
    expect(sh(root, 'rev-list', '--count', 'main..main-modernized')).toBe('3');
    expect(lines).toContain(
      'main-modernized is 1 commit(s) behind main; merge it if you want them',
    );
  });

  describe('files per run', () => {
    const TEN = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `src/f${String(i)}.js`,
        i === 0 ? 'export const f = 0;\n' : `import { f } from './f0';\nexport const g = f;\n`,
      ]),
    );
    const go = (root: string, files: RunOptions['files'], workers = 1, calls: StepContext[] = []) =>
      runModernizer({
        config: configFor(root, { concurrency: { workers } }),
        steps: { simplify: fakeStep('simplify', undefined, calls) },
        log: () => undefined,
        ...(files === undefined ? {} : { files }),
      });

    it('takes the next files in dependency order, up to the count', async () => {
      const root = await tempRepo(TEN);
      const calls: StepContext[] = [];

      const summary = await go(root, { kind: 'count', n: 3 }, 1, calls);

      expect(calls.map((c) => c.file)[0]).toBe('src/f0.js');
      expect(summary).toMatchObject({ done: 3, remaining: 7, stopped: false, limited: true });
    });

    it('continues with the next files on the next run', async () => {
      const root = await tempRepo(TEN);
      const first: StepContext[] = [];
      const second: StepContext[] = [];

      await go(root, { kind: 'count', n: 3 }, 1, first);
      const summary = await go(root, { kind: 'count', n: 3 }, 1, second);

      expect(second.map((c) => c.file).filter((f) => first.some((c) => c.file === f))).toEqual([]);
      expect(summary).toMatchObject({ done: 6, remaining: 4, limited: true });
    });

    it('never starts more files than the count, with more workers', async () => {
      const root = await tempRepo(TEN);
      const calls: StepContext[] = [];

      const summary = await go(root, { kind: 'count', n: 2 }, 4, calls);

      expect(calls).toHaveLength(2);
      expect(summary).toMatchObject({ done: 2, remaining: 8 });
    });

    it('takes every file with all, and says nothing of a limit when fewer files remain', async () => {
      const root = await tempRepo(APP);
      const lines: string[] = [];

      const all = await go(root, { kind: 'all' });
      const again = await runModernizer({
        config: configFor(root),
        steps,
        files: { kind: 'count', n: 50 },
        fresh: true,
        log: (l) => lines.push(l),
      });

      expect(all).toMatchObject({ done: 3, remaining: 0, limited: false });
      expect(again).toMatchObject({ done: 3, remaining: 0, limited: false });
      expect(lines.at(-1)).toMatch(/^finished: 3 done/);
    });

    it('says the limit was reached and how to go on', async () => {
      const root = await tempRepo(APP);
      const lines: string[] = [];

      await runModernizer({
        config: configFor(root),
        steps,
        files: { kind: 'count', n: 1 },
        log: (l) => lines.push(l),
      });

      expect(lines.at(-1)).toBe(
        'finished (limit of 1 reached): 1 done, 0 failed, 2 remaining — branch main-modernized — run again for the next',
      );
    });

    it('processes only a named file, even with an unsettled import', async () => {
      const root = await tempRepo(APP);
      const calls: StepContext[] = [];

      const summary = await go(root, { kind: 'path', file: 'src/Page.jsx' }, 1, calls);

      expect(calls.map((c) => c.file)).toEqual(['src/Page.jsx']);
      expect(summary).toMatchObject({ done: 1, remaining: 2, limited: false });
    });

    it('processes a named file again after it failed', async () => {
      const root = await tempRepo(APP);
      let broken = true;
      const step = fakeStep('simplify', () => (broken ? 'BROKEN\n' : '// ok\n'));
      const once = () =>
        runModernizer({
          config: configFor(root, { retry: { perStep: 0 } }),
          steps: { simplify: step },
          files: { kind: 'path', file: 'src/api.js' },
          log: () => undefined,
        });

      expect(await once()).toMatchObject({ failed: 1 });
      broken = false;
      expect(await once()).toMatchObject({ done: 1, failed: 0 });
    });

    it('refuses a named file that is missing or not selected, before anything runs', async () => {
      const root = await tempRepo({ ...APP, 'src/legacy/Old.jsx': 'export const o = 1;\n' });
      const calls: StepContext[] = [];
      const config = configFor(root, { source: { exclude: ['src/legacy/**'] } });
      const named = (file: string) =>
        runModernizer({
          config,
          steps: { simplify: fakeStep('simplify', undefined, calls) },
          files: { kind: 'path', file },
          log: () => undefined,
        });

      await expect(named('src/Nope.jsx')).rejects.toThrow('--files src/Nope.jsx: not found');
      await expect(named('src/legacy/Old.jsx')).rejects.toThrow(
        '--files src/legacy/Old.jsx: not selected by source.include/exclude',
      );
      expect(calls).toHaveLength(0);
      expect(sh(root, 'branch', '--list', 'main-modernized')).toBe('');
    });
  });

  describe('files without code', () => {
    it('skips an empty and a comment-only file without a step call', async () => {
      const root = await tempRepo({
        'src/empty.js': '\n',
        'src/license.js': '/* Copyright ACME */\n// nothing else\n',
        'src/api.js': 'export const api = 1;\n',
      });
      const calls: StepContext[] = [];
      const lines: string[] = [];

      const summary = await runModernizer({
        config: configFor(root),
        steps: { simplify: fakeStep('simplify', undefined, calls) },
        log: (l) => lines.push(l),
      });

      expect(calls.map((c) => c.file)).toEqual(['src/api.js']);
      expect(summary).toMatchObject({ done: 3, failed: 0 });
      expect(lines).toContain('· src/empty.js no code, skipped');
      expect(lines).toContain('· src/license.js no code, skipped');
      expect(sh(root, 'log', '--format=%s', 'main..main-modernized')).toBe('modernize: src/api.js');
    });

    it('does not count a skipped file toward --files', async () => {
      const root = await tempRepo({
        'src/a.js': '\n',
        'src/b.js': 'export const b = 1;\n',
        'src/c.js': 'export const c = 1;\n',
      });
      const calls: StepContext[] = [];

      const summary = await runModernizer({
        config: configFor(root),
        steps: { simplify: fakeStep('simplify', undefined, calls) },
        files: { kind: 'count', n: 1 },
        log: () => undefined,
      });

      expect(calls.map((c) => c.file)).toEqual(['src/b.js']);
      expect(summary).toMatchObject({ done: 2, remaining: 1, limited: true });
    });
  });

  it('with two workers still produces one commit per file', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [
        `src/f${String(i)}.js`,
        `export const f = ${String(i)};\n`,
      ]),
    );
    const root = await tempRepo(files);
    const config = configFor(root, { concurrency: { workers: 2 } });

    const summary = await runModernizer({ config, steps, log: quiet });

    expect(summary.done).toBe(6);
    expect(sh(root, 'rev-list', '--count', 'main..main-modernized')).toBe('6');
    for (let i = 0; i < 6; i++) {
      expect(sh(root, 'show', `main-modernized:src/f${String(i)}.js`)).toContain('// simplify');
    }
  });

  it('checks only the gates when every step is disabled, and commits nothing', async () => {
    const root = await tempRepo({ ...APP, 'src/bad.js': 'BROKEN\n' });
    const config = configFor(root, {
      steps: Object.fromEntries(
        ['analyze', 'characterize-tests', 'class-to-function', 'js-to-ts', 'simplify'].map((id) => [
          id,
          { enabled: false },
        ]),
      ),
    });

    const summary = await runModernizer({ config, steps: {}, log: quiet });

    expect(summary).toMatchObject({ done: 3, failed: 1 });
    expect(sh(root, 'rev-list', '--count', 'main..main-modernized')).toBe('0');
  });

  it('reports failures, continues, and exits zero', async () => {
    const root = await tempRepo(APP);
    const failing = fakeStep('simplify', (ctx) =>
      ctx.file === 'src/Card.jsx' ? 'BROKEN\n' : '// ok\n',
    );

    const summary = await runModernizer({
      config: configFor(root),
      steps: { simplify: failing },
      log: quiet,
    });

    expect(summary).toMatchObject({ done: 2, failed: 1, stopped: false });
  });

  it('stops after a failure when onFail is stop', async () => {
    const root = await tempRepo(APP);
    const failing = fakeStep('simplify', () => 'BROKEN\n');
    const config = configFor(root, { retry: { perStep: 0, onFail: 'stop' } });

    const summary = await runModernizer({ config, steps: { simplify: failing }, log: quiet });

    expect(summary).toMatchObject({ failed: 1, remaining: 2, stopped: true });
  });

  it('resumes without redoing settled files, and --fresh starts over', async () => {
    const root = await tempRepo(APP);
    const calls: StepContext[] = [];
    const counting = { simplify: fakeStep('simplify', () => '// once\n', calls) };
    await runModernizer({ config: configFor(root), steps: counting, log: quiet });
    const repo = await openRepository(root);
    const state = await loadState(statePath(runDirectory(repo, 'main-modernized')));
    if (state === undefined) throw new Error('no state');
    delete state.files['src/Page.jsx']; // as if interrupted before the last file
    await saveState(statePath(runDirectory(repo, 'main-modernized')), state);
    calls.length = 0;

    await runModernizer({ config: configFor(root), steps: counting, log: quiet });
    expect(calls.map((c) => c.file)).toEqual(['src/Page.jsx']);

    calls.length = 0;
    await runModernizer({ config: configFor(root), steps: counting, fresh: true, log: quiet });
    expect(calls).toHaveLength(3);
  });
});

describe('run and status commands', () => {
  async function run(argv: string[], steps?: StepRegistry) {
    let stdout = '';
    let stderr = '';
    const code = await main(
      argv,
      { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) },
      steps,
    );
    return { code, stdout, stderr };
  }

  async function writeConfig(root: string): Promise<string> {
    const path = join(root, '..', `${root.split('/').pop() ?? 'x'}.yaml`);
    await writeFile(
      path,
      [
        `target: ${JSON.stringify(root)}`,
        'steps:',
        '  analyze: { enabled: false }',
        '  characterize-tests: { enabled: false }',
        '  class-to-function: { enabled: false }',
        '  js-to-ts: { enabled: false }',
        'gates:',
        "  commands: ['! grep -q BROKEN {files}']",
        'retry: { perStep: 0 }',
        '',
      ].join('\n'),
    );
    return path;
  }

  it('runs, then reports the state with the failed file and its reason', async () => {
    const root = await tempRepo(APP);
    const config = await writeConfig(root);
    const failing = fakeStep('simplify', (ctx) => (ctx.file === 'src/api.js' ? 'BROKEN\n' : ''));

    const ran = await run(['run', config, '--files', 'all'], { simplify: failing });
    const status = await run(['status', config]);

    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('✗ src/api.js');
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('Branch: main-modernized\n');
    expect(status.stdout).toContain('done: 2 · failed: 1 · pending: 0');
    expect(status.stdout).toContain('src/api.js  simplify: ! grep -q BROKEN {files} failed:');
  });

  it('processes one file by default and exits 0 at the limit', async () => {
    const root = await tempRepo(APP);
    const config = await writeConfig(root);

    const ran = await run(['run', config], { simplify: fakeStep('simplify') });

    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('finished (limit of 1 reached): 1 done, 0 failed, 2 remaining');
  });

  it('reads --files as a count, all or a path, and refuses zero', async () => {
    const root = await tempRepo(APP);
    const config = await writeConfig(root);
    const calls: StepContext[] = [];
    const step = fakeStep('simplify', undefined, calls);

    const zero = await run(['run', config, '--files', '0'], { simplify: step });
    const missing = await run(['run', config, '--files', 'some'], { simplify: step });
    const named = await run(['run', config, '--files', './src/Card.jsx'], { simplify: step });

    expect(zero.code).not.toBe(0);
    expect(zero.stderr).toContain('--files');
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain('--files some: not found');
    expect(named.code).toBe(0);
    expect(calls.map((c) => c.file)).toEqual(['src/Card.jsx']);
    expect(fileSelection('all')).toEqual({ kind: 'all' });
    expect(fileSelection('12')).toEqual({ kind: 'count', n: 12 });
    expect(() => fileSelection('-3')).toThrow('positive integer');
  });

  it('keeps a separate state for each branch', async () => {
    const root = await tempRepo(APP);
    const config = await writeConfig(root);
    const quiet = fakeStep('simplify', () => '');

    await run(['run', config, '--files', 'all'], { simplify: quiet });
    sh(root, 'checkout', '--quiet', '-b', 'feature/y', 'main');
    const before = await run(['status', config]);
    const ran = await run(['run', config, '--files', 'all'], { simplify: quiet });
    sh(root, 'checkout', '--quiet', 'main');
    const first = await run(['status', config]);

    expect(before.stdout).toContain('Branch: feature/y-modernized (no run yet)');
    expect(ran.stdout).toContain('finished: 3 done');
    expect(first.stdout).toContain('Branch: main-modernized\n');
    expect(first.stdout).toContain('done: 3 · failed: 0 · pending: 0');
  });

  it('shows tokens and reported bugs in status', async () => {
    const root = await tempRepo(APP);
    const config = await writeConfig(root);
    const reporting: Step = {
      id: 'simplify',
      async run(ctx) {
        ctx.usage.add({ input_tokens: 100, output_tokens: 20 });
        if (ctx.file === 'src/Card.jsx')
          ctx.report({ line: 2, reason: 'renders one item too few' });
        await Promise.resolve();
      },
    };

    await run(['run', config, '--files', 'all'], { simplify: reporting });
    const status = await run(['status', config]);

    expect(status.stdout).toContain('Tokens: 360 (input 300 · output 60) · reported bugs: 1');
    expect(status.stdout).toContain('src/Card.jsx:2  renders one item too few');
  });

  it('with every step on by default, refuses to start until the target has a tsconfig.json', async () => {
    const root = await tempRepo(APP);
    const config = join(root, '..', `${root.split('/').pop() ?? 'x'}-default.yaml`);
    await writeFile(config, `target: ${JSON.stringify(root)}\n`);

    const result = await run(['run', config]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('the target has no tsconfig.json');
  });

  it('refuses a target outside any repository', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'modernizer-norepo-'));
    await writeFile(join(dir, 'a.js'), '');
    await writeFile(
      join(dir, 'c.yaml'),
      `target: ${JSON.stringify(dir)}\nsource: { include: ['*.js'] }\n`,
    );

    const result = await run(['run', join(dir, 'c.yaml')], { simplify: fakeStep('simplify') });

    expect(result.code).toBe(1);
  });
});
