import { join } from 'node:path';
import { findCycles } from './cycles.js';
import { discoverFiles, indexProjectFiles, type SourceSelection } from './discover.js';
import { extractImports, parseFiles } from './extract.js';
import { createResolver, readBaseUrl, type ResolvedImport } from './resolve.js';

export interface ImportGraph {
  /** The files being processed, relative to the target, sorted. */
  files: string[];
  /** Each file mapped to the processed files it imports, sorted. */
  edges: Map<string, string[]>;
  /** Every import of every file, classified. */
  imports: Map<string, ResolvedImport[]>;
  /** Files with an `import()` or `require()` that cannot be followed. */
  dynamic: string[];
  /** Files with syntax errors, and the errors. */
  parseErrors: Map<string, string[]>;
  /** Groups of files that import each other. */
  cycles: string[][];
  /** `baseUrl` used for absolute imports, relative to the target. */
  baseUrl?: string;
}

/** Builds the import graph of a target. Read-only: nothing in the target is written. */
export async function buildGraph(target: string, source: SourceSelection): Promise<ImportGraph> {
  const [files, projectFiles, baseUrl] = await Promise.all([
    discoverFiles(target, source),
    indexProjectFiles(target),
    readBaseUrl(target),
  ]);
  const resolver = createResolver(projectFiles, new Set(files), baseUrl);
  const parsed = parseFiles(files.map((file) => join(target, file)));

  const edges = new Map<string, string[]>();
  const imports = new Map<string, ResolvedImport[]>();
  const dynamic: string[] = [];
  const parseErrors = new Map<string, string[]>();

  for (const file of files) {
    const result = parsed.get(join(target, file));
    if (result === undefined) {
      parseErrors.set(file, ['could not be read']);
      edges.set(file, []);
      imports.set(file, []);
      continue;
    }
    if (result.syntaxErrors.length > 0) {
      parseErrors.set(file, result.syntaxErrors);
    }
    const extracted = extractImports(result.sourceFile);
    if (extracted.hasDynamicImport) {
      dynamic.push(file);
    }
    const resolved = extracted.specifiers.map((specifier) => resolver.resolve(file, specifier));
    imports.set(file, resolved);
    const deps = new Set<string>();
    for (const r of resolved) {
      if (r.kind === 'internal' && r.path !== undefined && r.path !== file) {
        deps.add(r.path);
      }
    }
    edges.set(
      file,
      [...deps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }

  const graph: ImportGraph = {
    files,
    edges,
    imports,
    dynamic,
    parseErrors,
    cycles: findCycles(edges),
  };
  if (baseUrl !== undefined) {
    graph.baseUrl = baseUrl;
  }
  return graph;
}
