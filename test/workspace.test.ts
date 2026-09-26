import { mkdir, mkdtemp, readFile, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRepository, parseGitVersion, RepositoryError } from '../src/run/git.js';
import { createWorktrees, removeWorktrees, RunBranch, runDirectory } from '../src/run/workspace.js';
import { sh, tempRepo, writeFiles } from './helpers/repo.js';

describe('openRepository', () => {
  it('finds the root, the shared git directory and the target prefix', async () => {
    const root = await tempRepo({ 'app/src/a.js': '' });
    const repo = await openRepository(join(root, 'app'));

    expect(repo.prefix).toBe('app');
    expect(repo.commonDir.endsWith('.git')).toBe(true);
  });

  it('refuses a directory that is not a repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modernizer-norepo-'));

    await expect(openRepository(dir)).rejects.toThrow(RepositoryError);
  });

  it('parses git versions', () => {
    expect(parseGitVersion('git version 2.43.0')).toEqual([2, 43]);
    expect(parseGitVersion('nope')).toBeUndefined();
  });
});

describe('workspace', () => {
  async function setup(files: Record<string, string> = { 'src/a.js': 'a\n', 'src/b.js': 'b\n' }) {
    const root = await tempRepo(files);
    const repo = await openRepository(root);
    const branch = new RunBranch(repo, 'modernizer/run');
    const tip = await branch.ensure('HEAD');
    const [w1, w2] = await createWorktrees(
      repo,
      runDirectory(repo, 'modernizer/run'),
      2,
      tip,
      join(root, 'node_modules'),
    );
    if (w1 === undefined || w2 === undefined) throw new Error('worktrees missing');
    return { root, repo, branch, tip, w1, w2 };
  }

  it('commits a worker change onto the branch without touching the checkout', async () => {
    const { root, branch, tip, w1 } = await setup();
    await writeFile(join(root, 'src/a.js'), 'user edit\n'); // uncommitted work in the user's checkout
    sh(root, 'add', 'src/a.js');
    const indexBefore = sh(root, 'diff', '--cached');

    await writeFile(join(w1.cwd, 'src/b.js'), 'migrated\n');
    expect(await w1.stage()).toEqual([{ status: 'M', path: 'src/b.js' }]);
    const commit = await w1.commit('modernize: src/b.js');
    const appended = await branch.append(tip, commit ?? '');

    expect(appended.ok).toBe(true);
    expect(sh(root, 'show', 'modernizer/run:src/b.js')).toBe('migrated');
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(await readFile(join(root, 'src/a.js'), 'utf8')).toBe('user edit\n');
    expect(sh(root, 'diff', '--cached')).toBe(indexBefore);
  });

  it('merges onto a tip another worker moved', async () => {
    const { root, branch, tip, w1, w2 } = await setup();
    await writeFile(join(w1.cwd, 'src/a.js'), 'A\n');
    await writeFile(join(w2.cwd, 'src/b.js'), 'B\n');
    await w1.stage();
    await w2.stage();
    const c1 = await w1.commit('a');
    const c2 = await w2.commit('b');

    expect((await branch.append(tip, c1 ?? '')).ok).toBe(true);
    expect((await branch.append(tip, c2 ?? '')).ok).toBe(true);
    expect(sh(root, 'show', 'modernizer/run:src/a.js')).toBe('A');
    expect(sh(root, 'show', 'modernizer/run:src/b.js')).toBe('B');
    expect(sh(root, 'rev-list', '--count', `${tip}..modernizer/run`)).toBe('2');
  });

  it('refuses a conflicting change and leaves the branch as it was', async () => {
    const { branch, tip, w1, w2 } = await setup();
    await writeFile(join(w1.cwd, 'src/a.js'), 'one\n');
    await writeFile(join(w2.cwd, 'src/a.js'), 'two\n');
    await w1.stage();
    await w2.stage();
    const c1 = await w1.commit('one');
    const c2 = await w2.commit('two');
    await branch.append(tip, c1 ?? '');
    const before = await branch.tip();

    const result = await branch.append(tip, c2 ?? '');

    expect(result.ok).toBe(false);
    expect(await branch.tip()).toBe(before);
  });

  it('reports a rename relative to the target and returns nothing to commit when unchanged', async () => {
    const { w1, tip } = await setup();
    const { rename } = await import('node:fs/promises');
    await rename(join(w1.cwd, 'src/a.js'), join(w1.cwd, 'src/a.tsx'));

    expect(await w1.stage()).toEqual([{ status: 'R', path: 'src/a.tsx', from: 'src/a.js' }]);
    await w1.reset(tip);
    await w1.stage();
    expect(await w1.commit('nothing')).toBeUndefined();
  });

  it('links node_modules into each worktree and never stages it', async () => {
    const root = await tempRepo({ 'src/a.js': 'a\n', '.gitignore': 'node_modules/\n' });
    await mkdir(join(root, 'node_modules', 'lib'), { recursive: true });
    await writeFiles(root, { 'node_modules/lib/index.js': '' });
    const repo = await openRepository(root);
    const branch = new RunBranch(repo, 'modernizer/run');
    const [w] = await createWorktrees(
      repo,
      runDirectory(repo, 'modernizer/run'),
      1,
      await branch.ensure('HEAD'),
      join(root, 'node_modules'),
    );
    if (w === undefined) throw new Error('worktree missing');

    expect(await readlink(join(w.cwd, 'node_modules'))).toBe(join(root, 'node_modules'));
    expect(await w.stage()).toEqual([]);
    await w.reset(await w.head());
    expect(await readlink(join(w.cwd, 'node_modules'))).toBe(join(root, 'node_modules'));

    await removeWorktrees(repo, [w]);
    expect(sh(root, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('keeps worktrees and state inside the git directory, out of git status', async () => {
    const { root } = await setup();

    expect(sh(root, 'status', '--porcelain')).toBe('');
  });
});
