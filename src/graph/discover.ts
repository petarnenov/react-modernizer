import { stat } from 'node:fs/promises';
import { glob } from 'tinyglobby';

/** Never project files, whatever the patterns say. */
const ALWAYS_IGNORED = ['**/node_modules/**', '**/.git/**', 'build/**'];

export class TargetError extends Error {
  override readonly name = 'TargetError';
}

export interface SourceSelection {
  include: readonly string[];
  exclude: readonly string[];
}

/** Code-unit order: the same on every machine and locale. */
function sorted(paths: string[]): string[] {
  return paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function assertDirectory(target: string): Promise<void> {
  const info = await stat(target).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new TargetError(`Target is not a readable directory: ${target}`);
  }
}

/** The files to process: POSIX paths relative to the target, sorted. */
export async function discoverFiles(target: string, source: SourceSelection): Promise<string[]> {
  await assertDirectory(target);
  const files = await glob([...source.include], {
    cwd: target,
    ignore: [...source.exclude, ...ALWAYS_IGNORED],
    onlyFiles: true,
    dot: false,
    expandDirectories: false,
  });
  return sorted(files);
}

/** Every file of the project, processed or not — what imports can resolve to. */
export async function indexProjectFiles(target: string): Promise<Set<string>> {
  await assertDirectory(target);
  const files = await glob(['**/*'], {
    cwd: target,
    ignore: ALWAYS_IGNORED,
    onlyFiles: true,
    dot: false,
    expandDirectories: false,
  });
  return new Set(files);
}
