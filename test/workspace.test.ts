import { mkdir, mkdtemp, readFile, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRepository, parseGitVersion, RepositoryError } from '../src/run/git.js';
import {
  createWorktrees,
  removeWorktrees,
  openRunBranch,
  runBranchName,
  runDirectory,
  worktreeDirectory,
} from '../src/run/workspace.js';
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

describe('run branch', () => {
  it('names the run branch after the current one, without nesting', () => {
    expect(runBranchName('feature/x')).toBe('feature/x-modernized');
    expect(runBranchName('feature/x-modernized')).toBe('feature/x-modernized');
  });

  it('creates the run branch from the current one and checks it out', async () => {
    const root = await tempRepo({ 'src/a.js': 'a\n' });
    const opened = await openRunBranch(await openRepository(root), root);

    expect(opened).toMatchObject({ current: 'main', created: true });
    expect(opened.behind).toBeUndefined();
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main-modernized');
    expect(sh(root, 'rev-parse', 'main-modernized')).toBe(sh(root, 'rev-parse', 'main'));
  });

  it('continues an existing run branch as it is and says how far behind it is', async () => {
    const root = await tempRepo({ 'src/a.js': 'a\n' });
    const repo = await openRepository(root);
    await openRunBranch(repo, root);
    await writeFile(join(root, 'src/a.js'), 'done\n');
    sh(root, 'commit', '--quiet', '-am', 'accepted');
    const kept = sh(root, 'rev-parse', 'HEAD');
    sh(root, 'checkout', '--quiet', 'main');
    await writeFile(join(root, 'late.txt'), 'x\n');
    sh(root, 'add', 'late.txt');
    sh(root, 'commit', '--quiet', '-m', 'late');

    const opened = await openRunBranch(repo, root);

    expect(opened).toMatchObject({
      created: false,
      behind: { original: 'main', commits: 1 },
    });
    expect(sh(root, 'rev-parse', 'HEAD')).toBe(kept);
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main-modernized');
  });

  it('continues on the run branch when it is already checked out', async () => {
    const root = await tempRepo({ 'src/a.js': 'a\n' });
    const repo = await openRepository(root);
    await openRunBranch(repo, root);

    const opened = await openRunBranch(repo, root);

    expect(opened).toMatchObject({ current: 'main-modernized', created: false });
    expect(sh(root, 'branch', '--list', '*modernized-modernized')).toBe('');
  });

  it('names uncommitted files relative to a target inside its repository', async () => {
    const root = await tempRepo({ 'app/src/a.js': 'a\n' });
    const target = join(root, 'app');
    await writeFile(join(target, 'src/a.js'), 'edited\n');

    await expect(openRunBranch(await openRepository(target), target)).rejects.toThrow(
      /tracked files:\n {2}src\/a\.js\n/,
    );
  });

  it('refuses a detached HEAD and uncommitted tracked changes, creating no branch', async () => {
    const root = await tempRepo({ 'src/a.js': 'a\n' });
    const repo = await openRepository(root);
    await writeFile(join(root, 'src/a.js'), 'edited\n');
    await writeFile(join(root, 'untracked.js'), 'u\n');

    await expect(openRunBranch(repo, root)).rejects.toThrow(
      /uncommitted changes to tracked files:\n {2}src\/a\.js/,
    );
    sh(root, 'checkout', '--quiet', '--', 'src/a.js');
    sh(root, 'checkout', '--quiet', '--detach');
    await expect(openRunBranch(repo, root)).rejects.toThrow('HEAD is detached');
    expect(sh(root, 'branch', '--list', 'main-modernized')).toBe('');
  });
});

describe('workspace', () => {
  async function setup(files: Record<string, string> = { 'src/a.js': 'a\n', 'src/b.js': 'b\n' }) {
    const root = await tempRepo(files);
    const repo = await openRepository(root);
    const { branch } = await openRunBranch(repo, root);
    const tip = await branch.tip();
    const [w1, w2] = await createWorktrees(
      repo,
      worktreeDirectory(repo, branch.name),
      2,
      tip,
      join(root, 'node_modules'),
    );
    if (w1 === undefined || w2 === undefined) throw new Error('worktrees missing');
    return { root, repo, branch, tip, w1, w2 };
  }

  it('commits a worker change onto the checked-out run branch and its working tree', async () => {
    const { root, branch, tip, w1 } = await setup();

    await writeFile(join(w1.cwd, 'src/b.js'), 'migrated\n');
    expect(await w1.stage()).toEqual([{ status: 'M', path: 'src/b.js' }]);
    const commit = await w1.commit('modernize: src/b.js');
    const appended = await branch.append(tip, commit ?? '');

    expect(appended.ok).toBe(true);
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main-modernized');
    expect(await readFile(join(root, 'src/b.js'), 'utf8')).toBe('migrated\n');
    expect(sh(root, 'status', '--porcelain')).toBe('');
    expect(sh(root, 'show', 'main:src/b.js')).toBe('b');
  });

  it('fails an append the working tree is in the way of, keeping the edit', async () => {
    const { root, branch, tip, w1 } = await setup();
    await writeFile(join(root, 'src/b.js'), 'user edit\n');

    await writeFile(join(w1.cwd, 'src/b.js'), 'migrated\n');
    await w1.stage();
    const result = await branch.append(tip, (await w1.commit('b')) ?? '');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('the checkout cannot take the commit');
    expect(await readFile(join(root, 'src/b.js'), 'utf8')).toBe('user edit\n');
    expect(await branch.tip()).toBe(tip);
  });

  it('merges onto a HEAD the user moved', async () => {
    const { root, branch, tip, w1 } = await setup();
    await writeFile(join(root, 'notes.txt'), 'n\n');
    sh(root, 'add', 'notes.txt');
    sh(root, 'commit', '--quiet', '-m', 'user commit');

    await writeFile(join(w1.cwd, 'src/b.js'), 'migrated\n');
    await w1.stage();
    const result = await branch.append(tip, (await w1.commit('b')) ?? '');

    expect(result.ok).toBe(true);
    expect(sh(root, 'log', '--format=%s', '-2')).toBe('b\nuser commit');
    expect(await readFile(join(root, 'src/b.js'), 'utf8')).toBe('migrated\n');
  });

  it('fails an append after the user checked out another branch', async () => {
    const { root, branch, tip, w1 } = await setup();
    sh(root, 'checkout', '--quiet', 'main');

    await writeFile(join(w1.cwd, 'src/b.js'), 'migrated\n');
    await w1.stage();
    const result = await branch.append(tip, (await w1.commit('b')) ?? '');

    expect(result).toEqual({ ok: false, reason: 'the checkout is no longer on main-modernized' });
    expect(sh(root, 'show', 'main:src/b.js')).toBe('b');
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
    expect(sh(root, 'show', 'main-modernized:src/a.js')).toBe('A');
    expect(sh(root, 'show', 'main-modernized:src/b.js')).toBe('B');
    expect(sh(root, 'rev-list', '--count', `${tip}..main-modernized`)).toBe('2');
    expect(await readFile(join(root, 'src/a.js'), 'utf8')).toBe('A\n');
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
    const { branch } = await openRunBranch(repo, root);
    const [w] = await createWorktrees(
      repo,
      worktreeDirectory(repo, branch.name),
      1,
      await branch.tip(),
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

describe('worktreeDirectory', () => {
  it('is outside the repository and outside every directory Jest ignores', async () => {
    const root = await tempRepo({ 'src/a.js': 'a\n' });
    const repo = await openRepository(root);

    const dir = worktreeDirectory(repo, 'modernizer/pilot-1');

    expect(dir.startsWith(join(tmpdir(), 'react-modernizer'))).toBe(true);
    expect(dir.endsWith('modernizer__pilot-1')).toBe(true);
    expect(dir.split('/')).not.toContain('.git');
    expect(dir.startsWith(root)).toBe(false);
    // State stays with the repository.
    expect(runDirectory(repo, 'modernizer/pilot-1').startsWith(repo.commonDir)).toBe(true);
  });

  it('differs per repository', async () => {
    const a = await openRepository(await tempRepo({ 'a.js': 'a\n' }));
    const b = await openRepository(await tempRepo({ 'a.js': 'a\n' }));

    expect(worktreeDirectory(a, 'r')).not.toBe(worktreeDirectory(b, 'r'));
  });

  it('refuses a temp directory under a directory tools ignore', async () => {
    const repo = await openRepository(await tempRepo({ 'a.js': 'a\n' }));

    expect(() => worktreeDirectory(repo, 'r', '/home/me/project/.git/tmp')).toThrow(
      'ignore files under ".git"',
    );
  });
});
