import { access } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { CODE_EXTENSIONS } from '../graph/resolve.js';
import type { ChangedFile } from './workspace.js';

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * Where a file is now: at `path`, or — after a step changed its extension, as JavaScript → TypeScript does — at the
 * same name with another code extension. Undefined when it is gone.
 */
export async function locate(cwd: string, path: string): Promise<string | undefined> {
  if (await exists(join(cwd, path))) {
    return path;
  }
  const ext = posix.extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (const candidate of CODE_EXTENSIONS) {
    if (await exists(join(cwd, stem + candidate))) {
      return stem + candidate;
    }
  }
  return undefined;
}

/** The current path of a file that existed at the base, from the staged changes (git's rename detection). */
export function renamedTo(changes: readonly ChangedFile[], basePath: string): string | undefined {
  return changes.find((c) => c.from === basePath)?.path;
}
