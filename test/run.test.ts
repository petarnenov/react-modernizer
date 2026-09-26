import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { parseConfig } from '../src/config/load.js';
import type { ModernizerConfig, StepId } from '../src/config/schema.js';
import { Semaphore } from '../src/run/gates.js';
import { openRepository } from '../src/run/git.js';
import { runModernizer, statePath, StepsMissingError } from '../src/run/runner.js';
import { emptyState, loadState, saveState } from '../src/run/state.js';
import { processFile, type FileJob } from '../src/run/transaction.js';
import { createWorktrees, RunBranch, runDirectory } from '../src/run/workspace.js';
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
    const branch = new RunBranch(repo, 'r');
    const base = await branch.ensure('HEAD');
    const [worktree] = await createWorktrees(
      repo,
      runDirectory(repo, 'r'),
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
        commands: ['! grep -q BROKEN {files}'],
        forbid: [': any'],
        timeoutSeconds: 30,
        semaphore: new Semaphore(1),
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

  it('commits one file per commit on the run branch, leaves the checkout alone', async () => {
    const root = await tempRepo(APP);
    await writeFile(join(root, 'src/api.js'), 'uncommitted user work\n');
    const lines: string[] = [];

    const summary = await runModernizer({
      config: configFor(root),
      steps,
      log: (l) => lines.push(l),
    });

    expect(summary).toMatchObject({ total: 3, done: 3, failed: 0, remaining: 0, stopped: false });
    expect(sh(root, 'log', '--format=%s', 'main..modernizer/run').split('\n')).toEqual([
      'modernize: src/Page.jsx',
      'modernize: src/Card.jsx',
      'modernize: src/api.js',
    ]);
    expect(await readFile(join(root, 'src/api.js'), 'utf8')).toBe('uncommitted user work\n');
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(sh(root, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(lines.some((l) => l.startsWith('warning: the target has uncommitted changes'))).toBe(
      true,
    );
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
    expect(sh(root, 'rev-list', '--count', 'main..modernizer/run')).toBe('6');
    for (let i = 0; i < 6; i++) {
      expect(sh(root, 'show', `modernizer/run:src/f${String(i)}.js`)).toContain('// simplify');
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
    expect(sh(root, 'rev-list', '--count', 'main..modernizer/run')).toBe('0');
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
    const state = await loadState(statePath(runDirectory(repo, 'modernizer/run')));
    if (state === undefined) throw new Error('no state');
    delete state.files['src/Page.jsx']; // as if interrupted before the last file
    await saveState(statePath(runDirectory(repo, 'modernizer/run')), state);
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

    const ran = await run(['run', config], { simplify: failing });
    const status = await run(['status', config]);

    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('✗ src/api.js');
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('done: 2 · failed: 1 · pending: 0');
    expect(status.stdout).toContain('src/api.js  simplify: ! grep -q BROKEN {files} failed:');
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

    await run(['run', config], { simplify: reporting });
    const status = await run(['status', config]);

    expect(status.stdout).toContain('Tokens: 360 (input 300 · output 60) · reported bugs: 1');
    expect(status.stdout).toContain('src/Card.jsx:2  renders one item too few');
  });

  it('refuses to run with the default steps, which are not implemented yet', async () => {
    const root = await tempRepo(APP);
    const config = join(root, '..', `${root.split('/').pop() ?? 'x'}-default.yaml`);
    await writeFile(config, `target: ${JSON.stringify(root)}\n`);

    const result = await run(['run', config]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'not implemented yet: analyze, class-to-function, js-to-ts, simplify',
    );
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
