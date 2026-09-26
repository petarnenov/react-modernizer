import { createHash } from 'node:crypto';
import { lstat, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { git, GitError, type Repository } from './git.js';

const branchDir = (branch: string) => branch.replaceAll('/', '__');

/** Where a run keeps its state: inside the shared git directory, invisible to `git status`. */
export function runDirectory(repo: Repository, branch: string): string {
  return join(repo.commonDir, 'modernizer', 'runs', branchDir(branch));
}

/**
 * Path segments tools skip: Jest's file map ignores everything under `.git`, `.hg` and `.sl`, and most tools skip
 * `node_modules`. A worktree under one of them has tests Jest cannot see.
 */
const IGNORED_SEGMENTS = new Set(['.git', '.hg', '.sl', 'node_modules']);

/**
 * Where a run's worktrees live: in the system temp directory, outside the repository and outside any directory
 * tools ignore. One directory per repository (by its git directory) and run branch.
 */
export function worktreeDirectory(
  repo: Repository,
  branch: string,
  base: string = tmpdir(),
): string {
  const id = createHash('sha256').update(repo.commonDir).digest('hex').slice(0, 12);
  const dir = join(base, 'react-modernizer', `${basename(repo.root)}-${id}`, branchDir(branch));
  const ignored = dir.split(sep).find((segment) => IGNORED_SEGMENTS.has(segment));
  if (ignored !== undefined) {
    throw new Error(
      `worktrees cannot live under ${dir}: tools such as Jest ignore files under "${ignored}". Set TMPDIR to another directory.`,
    );
  }
  return dir;
}

const NODE_MODULES_PATHSPEC = ':(exclude,glob)**/node_modules';

export type AppendResult = { ok: true; commit: string } | { ok: false; reason: string };

/** The branch accepted files are committed to. Appends are serialised within the process. */
export class RunBranch {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repo: Repository,
    readonly name: string,
  ) {}

  private get ref(): string {
    return `refs/heads/${this.name}`;
  }

  /** Creates the branch at `base` unless it exists; returns its tip. */
  async ensure(base: string): Promise<string> {
    const existing = await git(this.repo.root, ['rev-parse', '--verify', '--quiet', this.ref], {
      allowFailure: true,
    });
    if (existing.code === 0) {
      return existing.stdout.trim();
    }
    const start = (
      await git(this.repo.root, ['rev-parse', '--verify', `${base}^{commit}`])
    ).stdout.trim();
    await git(this.repo.root, ['update-ref', this.ref, start, '']);
    return start;
  }

  async tip(): Promise<string> {
    return (await git(this.repo.root, ['rev-parse', '--verify', this.ref])).stdout.trim();
  }

  /**
   * Adds a worker's commit, made on top of `workerBase`, to the branch without any checkout. When the tip has moved
   * since, the change is merged onto it with `merge-tree`; a conflict leaves the branch as it was.
   */
  append(workerBase: string, workerCommit: string): Promise<AppendResult> {
    const next = this.queue.then(() => this.appendNow(workerBase, workerCommit));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async appendNow(workerBase: string, workerCommit: string): Promise<AppendResult> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const tip = await this.tip();
      let commit = workerCommit;
      if (tip !== workerBase) {
        const merged = await git(
          this.repo.root,
          ['merge-tree', '--write-tree', '--merge-base', workerBase, tip, workerCommit],
          { allowFailure: true },
        );
        if (merged.code === 1) {
          return { ok: false, reason: 'conflicts with changes already on the run branch' };
        }
        if (merged.code !== 0) {
          throw new GitError(['merge-tree'], merged.code, merged.stderr);
        }
        const tree = merged.stdout.split('\n')[0]?.trim() ?? '';
        const message = (await git(this.repo.root, ['log', '-1', '--format=%B', workerCommit]))
          .stdout;
        commit = (
          await git(this.repo.root, ['commit-tree', tree, '-p', tip, '-m', message.trim()], {
            env: this.repo.identityEnv,
          })
        ).stdout.trim();
      }
      // Compare-and-swap: only moves the branch if nobody else moved it meanwhile.
      const moved = await git(this.repo.root, ['update-ref', this.ref, commit, tip], {
        allowFailure: true,
      });
      if (moved.code === 0) {
        return { ok: true, commit };
      }
    }
    return { ok: false, reason: 'the run branch kept moving; gave up after 5 attempts' };
  }
}

export interface ChangedFile {
  /** `A`dded, `M`odified, `D`eleted, `R`enamed, … as git reports it. */
  status: string;
  /** Path relative to the target. */
  path: string;
  /** For a rename, where it came from (relative to the target). */
  from?: string;
}

/** One worker's isolated copy of the repository. */
export class Worktree {
  /** Directory of the target inside this worktree; steps and gates run here. */
  readonly cwd: string;

  constructor(
    private readonly repo: Repository,
    readonly path: string,
    /** The worker's `{cache}`: outside the worktree, kept across runs. */
    readonly cache: string = join(path, '..', 'cache', basename(path)),
  ) {
    this.cwd = repo.prefix === '' ? path : join(path, repo.prefix);
  }

  /** Puts back whatever changed since the last `stage()`, e.g. files the gates wrote. `node_modules` is left alone. */
  async discardUnstaged(): Promise<void> {
    await this.restore(await this.unstagedChanges());
  }

  /** Discards everything and checks out `commit`. The linked `node_modules` survives. */
  async reset(commit: string): Promise<void> {
    await git(this.path, ['reset', '--quiet', '--hard', commit]);
    await git(this.path, ['clean', '-ffdq', '-e', 'node_modules']);
  }

  async head(): Promise<string> {
    return (await git(this.path, ['rev-parse', 'HEAD'])).stdout.trim();
  }

  /** Stages every change except `node_modules` and lists the changed files relative to the target. */
  async stage(): Promise<ChangedFile[]> {
    await git(this.path, ['add', '--all', '--', '.', NODE_MODULES_PATHSPEC]);
    // Run from the target's directory: `--relative` then reports paths relative to the target.
    const out = (
      await git(this.cwd, ['diff', '--cached', '--name-status', '-M', '-z', '--relative', 'HEAD'])
    ).stdout;
    const parts = out.split('\0').filter((p) => p !== '');
    const changed: ChangedFile[] = [];
    for (let i = 0; i < parts.length;) {
      const status = parts[i++] ?? '';
      // A rename or copy lists its source first, then its destination.
      const from =
        status.startsWith('R') || status.startsWith('C') ? (parts[i++] ?? '') : undefined;
      const path = parts[i++] ?? '';
      changed.push(
        from === undefined
          ? { status: status.charAt(0), path }
          : { status: status.charAt(0), path, from },
      );
    }
    return changed;
  }

  /**
   * Paths changed since the last `stage()` — what a step just did — relative to the target. `node_modules` is not
   * reported.
   */
  async unstagedChanges(): Promise<string[]> {
    const modified = await git(this.cwd, ['diff', '--name-only', '-z', '--relative']);
    const added = await git(this.cwd, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '.',
      NODE_MODULES_PATHSPEC,
    ]);
    const paths = [...modified.stdout.split('\0'), ...added.stdout.split('\0')].filter(
      (p) => p !== '',
    );
    return [...new Set(paths)].sort();
  }

  /** Puts paths back as they were at the last `stage()`: tracked files from the index, new files removed. */
  async restore(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      const tracked = await git(this.cwd, ['ls-files', '--error-unmatch', '--', path], {
        allowFailure: true,
      });
      if (tracked.code === 0) {
        await git(this.cwd, ['checkout', '--', path]);
      } else {
        await rm(join(this.cwd, path), { recursive: true, force: true });
      }
    }
  }

  /** The tree the index holds now: equal trees mean equal staged content. */
  async stagedTree(): Promise<string> {
    return (await git(this.path, ['write-tree'])).stdout.trim();
  }

  /** The staged diff with rename detection and no context: exactly the lines the change adds and removes. */
  async stagedDiff(): Promise<string> {
    return (
      await git(this.cwd, ['diff', '--cached', '-M', '-U0', '--no-color', '--relative', 'HEAD'])
    ).stdout;
  }

  /** Commits the staged changes; undefined when there is nothing to commit. User hooks are not run. */
  async commit(message: string): Promise<string | undefined> {
    const staged = await git(this.path, ['diff', '--cached', '--quiet', 'HEAD'], {
      allowFailure: true,
    });
    if (staged.code === 0) {
      return undefined;
    }
    await git(
      this.path,
      ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', message],
      { env: this.repo.identityEnv },
    );
    return this.head();
  }
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/** Creates `count` worktrees at `commit` in `base`, replacing leftovers of an interrupted run. */
export async function createWorktrees(
  repo: Repository,
  base: string,
  count: number,
  commit: string,
  targetNodeModules: string,
): Promise<Worktree[]> {
  await mkdir(base, { recursive: true });
  await git(repo.root, ['worktree', 'prune']);
  const linkNodeModules = await exists(targetNodeModules);

  const worktrees: Worktree[] = [];
  for (let i = 1; i <= count; i++) {
    const path = join(base, `w${String(i)}`);
    if (await exists(path)) {
      await git(repo.root, ['worktree', 'remove', '--force', path], { allowFailure: true });
      await rm(path, { recursive: true, force: true });
    }
    await git(repo.root, ['worktree', 'add', '--quiet', '--detach', path, commit]);
    const worktree = new Worktree(repo, path);
    await mkdir(worktree.cache, { recursive: true });
    const link = join(worktree.cwd, 'node_modules');
    if (linkNodeModules && !(await exists(link))) {
      await symlink(targetNodeModules, link, 'dir');
    }
    worktrees.push(worktree);
  }
  return worktrees;
}

export async function removeWorktrees(
  repo: Repository,
  worktrees: readonly Worktree[],
): Promise<void> {
  for (const worktree of worktrees) {
    await git(repo.root, ['worktree', 'remove', '--force', worktree.path], { allowFailure: true });
  }
  await git(repo.root, ['worktree', 'prune'], { allowFailure: true });
}
