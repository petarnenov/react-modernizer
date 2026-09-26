import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import type { Importer } from '../steps/step.js';
import { indexProjectFiles, type SourceSelection } from './discover.js';
import { CODE_EXTENSIONS, createResolver, readBaseUrl } from './resolve.js';

const READ_BATCH = 64;

/**
 * The directories the source patterns start from: `src/**\/*.js` and `src/pages/Card.js` both give `src`. A pattern
 * that starts with a wildcard gives the whole target.
 */
export function sourceRoots(include: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const pattern of include) {
    const first = pattern.split('/')[0] ?? '';
    const isFile = !pattern.includes('/');
    roots.add(isFile || /[*?{[]/.test(first) ? '' : first);
  }
  return roots.has('') ? [''] : [...roots].sort();
}

function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext)) && !path.endsWith('.d.ts');
}

/** Import and require specifiers of a file, read with TypeScript's fast pre-processor rather than a full parse. */
function specifiersOf(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
}

/**
 * Who imports each file, across every code file under the source roots — included in the run or not. In a codebase
 * being migrated, most importers of a JavaScript file are TypeScript files the run never processes.
 */
export async function indexImporters(
  target: string,
  source: SourceSelection,
): Promise<Map<string, Importer[]>> {
  const [projectFiles, baseUrl] = await Promise.all([
    indexProjectFiles(target),
    readBaseUrl(target),
  ]);
  const roots = sourceRoots(source.include);
  const code = [...projectFiles]
    .filter(isCodeFile)
    .filter((f) => roots.some((root) => root === '' || f.startsWith(`${root}/`)))
    .sort();
  const resolver = createResolver(projectFiles, new Set(code), baseUrl);

  const importers = new Map<string, Importer[]>();
  for (let i = 0; i < code.length; i += READ_BATCH) {
    const batch = code.slice(i, i + READ_BATCH);
    const texts = await Promise.all(
      batch.map((file) => readFile(join(target, file), 'utf8').catch(() => '')),
    );
    batch.forEach((file, j) => {
      for (const specifier of specifiersOf(texts[j] ?? '')) {
        const resolved = resolver.resolve(file, specifier);
        if (resolved.kind === 'internal' && resolved.path !== undefined && resolved.path !== file) {
          const list = importers.get(resolved.path) ?? [];
          list.push({ file, specifier });
          importers.set(resolved.path, list);
        }
      }
    });
  }
  return importers;
}
