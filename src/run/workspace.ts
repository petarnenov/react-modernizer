import { lstat, mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { git, GitError, type Repository } from './git.js';

/** Where a run keeps its state and worktrees: inside the shared git directory, invisible to `git status`. */
export function runDirectory(repo: Repository, branch: string): string {
  return join(repo.commonDir, 'modernizer', 'runs', branch.replaceAll('/', '__'));
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
}

/** One worker's isolated copy of the repository. */
export class Worktree {
  /** Directory of the target inside this worktree; steps and gates run here. */
  readonly cwd: string;

  constructor(
    private readonly repo: Repository,
    readonly path: string,
  ) {
    this.cwd = repo.prefix === '' ? path : join(path, repo.prefix);
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
      if (status.startsWith('R') || status.startsWith('C')) {
        i++; // source path; the destination follows
      }
      const path = parts[i++] ?? '';
      changed.push({ status: status.charAt(0), path });
    }
    return changed;
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

/** Creates `count` worktrees at `commit`, replacing leftovers of an interrupted run. */
export async function createWorktrees(
  repo: Repository,
  runDir: string,
  count: number,
  commit: string,
  targetNodeModules: string,
): Promise<Worktree[]> {
  const base = join(runDir, 'worktrees');
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
