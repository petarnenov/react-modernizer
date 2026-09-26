import { mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findForbidden, runGateCommands, Semaphore, shellQuote } from '../src/run/gates.js';
import { openRepository } from '../src/run/git.js';
import { createWorktrees, RunBranch, runDirectory } from '../src/run/workspace.js';
import { tempRepo } from './helpers/repo.js';

const run = async (commands: string[], files: string[] = [], timeoutSeconds = 30) =>
  runGateCommands({
    commands,
    cwd: await mkdtemp(join(tmpdir(), 'modernizer-gates-')),
    files,
    timeoutSeconds,
    semaphore: new Semaphore(1),
  });

describe('runGateCommands', () => {
  it('passes when every command exits zero', async () => {
    expect(await run(['true', 'exit 0'])).toEqual({ ok: true });
  });

  it('stops at the first failure and reports it', async () => {
    const result = await run(['echo one', 'echo broken >&2; exit 3', 'touch ran-third']);

    expect(result).toEqual({ ok: false, gate: 'echo broken >&2; exit 3', output: 'broken\n' });
  });

  it('does not run commands after a failure', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'modernizer-gates-'));
    await runGateCommands({
      commands: ['false', 'touch ran-third'],
      cwd,
      files: [],
      timeoutSeconds: 30,
      semaphore: new Semaphore(1),
    });
    const { existsSync } = await import('node:fs');

    expect(existsSync(join(cwd, 'ran-third'))).toBe(false);
  });

  it('passes each file as one argument, spaces and quotes included', async () => {
    const quoted = await runGateCommands({
      commands: [
        'set -- {files}; test $# -eq 2 && test "$1" = "src/My Card.jsx" && test "$2" = "it\'s.js"',
      ],
      cwd: tmpdir(),
      files: ['src/My Card.jsx', "it's.js"],
      timeoutSeconds: 30,
      semaphore: new Semaphore(1),
    });
    expect(quoted).toEqual({ ok: true });
  });

  it('stops a hanging command at the timeout, including what it started', async () => {
    const started = Date.now();
    const result = await run(['sleep 30 & sleep 30; wait'], [], 1);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.output).toContain('1s timeout');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('never runs more commands at once than the semaphore allows', async () => {
    const semaphore = new Semaphore(2);
    const dir = await mkdtemp(join(tmpdir(), 'modernizer-gates-'));
    const counter = join(dir, 'log');
    // Each command records start and end; overlap is read back from the log.
    const command = `echo start >> ${shellQuote(counter)}; sleep 0.2; echo end >> ${shellQuote(counter)}`;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        runGateCommands({
          commands: [command],
          cwd: dir,
          files: [],
          timeoutSeconds: 30,
          semaphore,
        }),
      ),
    );
    const { readFile } = await import('node:fs/promises');
    let active = 0;
    let peak = 0;
    for (const line of (await readFile(counter, 'utf8')).trim().split('\n')) {
      active += line === 'start' ? 1 : -1;
      peak = Math.max(peak, active);
    }

    expect(peak).toBe(2);
  });
});

describe('findForbidden', () => {
  const forbid = [': any', 'eslint-disable'];

  it('fails on a pattern in an added line, naming file, pattern and line', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-const x = 1;',
      '+const x: any = 1;',
    ].join('\n');

    expect(findForbidden(diff, forbid)).toEqual({
      ok: false,
      gate: 'forbidden patterns',
      output: 'src/a.ts: ": any" in: const x: any = 1;',
    });
  });

  it('ignores patterns on removed lines', () => {
    expect(findForbidden('+++ b/a.js\n-// eslint-disable-next-line\n', forbid)).toEqual({
      ok: true,
    });
  });

  it('ignores a pattern that was already there when a .jsx file becomes .tsx', async () => {
    const root = await tempRepo({
      'src/Card.jsx':
        '// eslint-disable-next-line\nexport const Card = () => null;\nexport const x = 1;\n',
    });
    const repo = await openRepository(root);
    const [w] = await createWorktrees(
      repo,
      runDirectory(repo, 'r'),
      1,
      await new RunBranch(repo, 'r').ensure('HEAD'),
      join(root, 'node_modules'),
    );
    if (w === undefined) throw new Error('worktree missing');
    await rename(join(w.cwd, 'src/Card.jsx'), join(w.cwd, 'src/Card.tsx'));
    await writeFile(
      join(w.cwd, 'src/Card.tsx'),
      '// eslint-disable-next-line\nexport const Card = (): null => null;\nexport const x = 1;\n',
    );
    await w.stage();

    expect(findForbidden(await w.stagedDiff(), forbid)).toEqual({ ok: true });
  });
});
