import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Runs git synchronously in `cwd` and returns trimmed stdout. For test setup only. */
export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** A repository on branch `main` with the given files committed. */
export async function tempRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modernizer-repo-'));
  sh(root, 'init', '--quiet', '--initial-branch=main');
  sh(root, 'config', 'user.name', 'Test');
  sh(root, 'config', 'user.email', 'test@example.com');
  sh(root, 'config', 'commit.gpgsign', 'false');
  await writeFiles(root, files);
  sh(root, 'add', '--all');
  sh(root, 'commit', '--quiet', '-m', 'initial');
  return root;
}
