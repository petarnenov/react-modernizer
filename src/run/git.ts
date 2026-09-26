import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative, sep } from 'node:path';

export class RepositoryError extends Error {
  override readonly name = 'RepositoryError';
}

export class GitError extends Error {
  override readonly name = 'GitError';
  constructor(
    readonly args: readonly string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed (${String(code)}): ${stderr.trim()}`);
  }
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitOptions {
  env?: NodeJS.ProcessEnv;
  /** Return non-zero exits instead of throwing. */
  allowFailure?: boolean;
}

/** Runs git without a shell. Throws {@link GitError} on a non-zero exit unless `allowFailure` is set. */
export function git(
  cwd: string,
  args: readonly string[],
  options: GitOptions = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 256 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        if (code !== 0 && options.allowFailure !== true) {
          reject(new GitError(args, code, stderr || error?.message || ''));
          return;
        }
        resolve({ stdout, stderr, code });
      },
    );
  });
}

export const MIN_GIT_VERSION: readonly [number, number] = [2, 38];

export function parseGitVersion(output: string): [number, number] | undefined {
  const match = /git version (\d+)\.(\d+)/.exec(output);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : [Number(match[1]), Number(match[2])];
}

export interface Repository {
  /** Top-level directory of the working tree that contains the target. */
  root: string;
  /** The shared git directory (the main `.git`, also for worktrees). */
  commonDir: string;
  /** The target relative to `root`, POSIX, `''` when the target is the root. */
  prefix: string;
  /** Author and committer to use when the repository has none configured. */
  identityEnv: NodeJS.ProcessEnv;
}

/** Facts about the repository the target lives in. Refuses a non-repository and a git older than 2.38. */
export async function openRepository(target: string): Promise<Repository> {
  const version = parseGitVersion(
    (await git(target, ['--version']).catch(() => ({ stdout: '' }))).stdout,
  );
  if (version === undefined) {
    throw new RepositoryError('git is not installed or not on PATH');
  }
  const [major, minor] = version;
  if (major < MIN_GIT_VERSION[0] || (major === MIN_GIT_VERSION[0] && minor < MIN_GIT_VERSION[1])) {
    throw new RepositoryError(
      `git ${String(major)}.${String(minor)} is too old; ${MIN_GIT_VERSION.join('.')} or newer is needed`,
    );
  }

  const inside = await git(target, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    throw new RepositoryError(`Target is not inside a git repository: ${target}`);
  }
  const facts = await git(target, [
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-common-dir',
  ]);
  const [root = '', commonDir = ''] = facts.stdout.trim().split('\n');
  const prefix = relative(await realpath(root), await realpath(target))
    .split(sep)
    .join('/');

  const name = await git(root, ['config', 'user.name'], { allowFailure: true });
  const email = await git(root, ['config', 'user.email'], { allowFailure: true });
  const identityEnv: NodeJS.ProcessEnv =
    name.stdout.trim() !== '' && email.stdout.trim() !== ''
      ? {}
      : {
          GIT_AUTHOR_NAME: 'react-modernizer',
          GIT_AUTHOR_EMAIL: 'react-modernizer@localhost',
          GIT_COMMITTER_NAME: 'react-modernizer',
          GIT_COMMITTER_EMAIL: 'react-modernizer@localhost',
        };

  return { root, commonDir, prefix, identityEnv };
}
