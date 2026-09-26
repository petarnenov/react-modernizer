import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import ts from 'typescript';

export const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'] as const;

export type ImportKind = 'internal' | 'outside' | 'asset' | 'package' | 'unresolved';

export interface ResolvedImport {
  specifier: string;
  kind: ImportKind;
  /** The project file it resolved to, relative to the target; absent for packages and unresolved imports. */
  path?: string;
}

export interface Resolver {
  resolve(fromFile: string, specifier: string): ResolvedImport;
}

function isCode(path: string): boolean {
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Resolves specifiers the way a Create React App project does, against an index of the project's files: relative
 * paths, `baseUrl` absolute imports, omitted extensions and directory `index` files.
 *
 * @param projectFiles every project file, POSIX paths relative to the target
 * @param processed the files being processed (a subset of `projectFiles`)
 * @param baseUrl the `baseUrl` directory relative to the target, if any
 */
export function createResolver(
  projectFiles: ReadonlySet<string>,
  processed: ReadonlySet<string>,
  baseUrl?: string,
): Resolver {
  const find = (base: string): string | undefined => {
    if (base.startsWith('../') || base === '..' || posix.isAbsolute(base)) {
      return undefined; // outside the target
    }
    const candidates = [
      base,
      ...CODE_EXTENSIONS.map((ext) => base + ext),
      ...CODE_EXTENSIONS.map((ext) => posix.join(base, `index${ext}`)),
    ];
    return candidates.find((candidate) => projectFiles.has(candidate));
  };

  const classify = (specifier: string, path: string): ResolvedImport => {
    if (!isCode(path)) return { specifier, kind: 'asset', path };
    return { specifier, kind: processed.has(path) ? 'internal' : 'outside', path };
  };

  return {
    resolve(fromFile, specifier) {
      if (
        specifier.startsWith('./') ||
        specifier.startsWith('../') ||
        specifier === '.' ||
        specifier === '..'
      ) {
        const path = find(posix.normalize(posix.join(posix.dirname(fromFile), specifier)));
        return path === undefined ? { specifier, kind: 'unresolved' } : classify(specifier, path);
      }
      if (specifier.startsWith('/')) {
        return { specifier, kind: 'unresolved' };
      }
      if (baseUrl !== undefined && !specifier.startsWith('@')) {
        const path = find(posix.normalize(posix.join(baseUrl, specifier)));
        if (path !== undefined) {
          return classify(specifier, path);
        }
      }
      return { specifier, kind: 'package' };
    },
  };
}

/**
 * `compilerOptions.baseUrl` from `jsconfig.json`, else `tsconfig.json`, at the target root, relative to the target.
 * Both files may contain comments. Only `baseUrl` is honoured — CRA supports nothing else.
 */
export async function readBaseUrl(target: string): Promise<string | undefined> {
  for (const name of ['jsconfig.json', 'tsconfig.json']) {
    const text = await readFile(posix.join(target, name), 'utf8').catch(() => undefined);
    if (text === undefined) {
      continue;
    }
    const { config } = ts.parseConfigFileTextToJson(name, text) as { config?: unknown };
    const baseUrl = (config as { compilerOptions?: { baseUrl?: unknown } } | undefined)
      ?.compilerOptions?.baseUrl;
    if (typeof baseUrl === 'string' && baseUrl.length > 0) {
      const normalized = posix.normalize(baseUrl).replace(/\/+$/, '');
      return normalized === '.' || normalized === '' ? '' : normalized;
    }
    return undefined;
  }
  return undefined;
}
