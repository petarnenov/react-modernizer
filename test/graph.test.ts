import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXCLUDE } from '../src/config/schema.js';
import { buildGraph } from '../src/graph/build.js';
import { findCycles } from '../src/graph/cycles.js';
import { discoverFiles, TargetError } from '../src/graph/discover.js';
import { extractImports, parseSource } from '../src/graph/extract.js';
import { createResolver, readBaseUrl } from '../src/graph/resolve.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cra-app');
const DEFAULT_SOURCE = { include: ['src/**/*.{js,jsx}'], exclude: DEFAULT_EXCLUDE };

async function tempTarget(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modernizer-graph-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe('discoverFiles', () => {
  it('selects source files and leaves tests and test setup out', async () => {
    const files = await discoverFiles(FIXTURE, DEFAULT_SOURCE);

    expect(files).toContain('src/components/Card.jsx');
    expect(files).not.toContain('src/components/Card.test.jsx');
    expect(files).not.toContain('src/__tests__/app.js');
    expect(files).not.toContain('src/setupTests.js');
    expect(files).not.toContain('src/utils/format.ts');
  });

  it('returns the same sorted list every time', async () => {
    const first = await discoverFiles(FIXTURE, DEFAULT_SOURCE);
    const second = await discoverFiles(FIXTURE, DEFAULT_SOURCE);

    expect(second).toEqual(first);
    expect(first).toEqual([...first].sort());
  });

  it('never discovers files under node_modules', async () => {
    const root = await tempTarget({
      'src/App.js': '',
      'src/node_modules/lib/index.js': '',
      'node_modules/react/index.js': '',
    });

    expect(await discoverFiles(root, { include: ['**/*.js'], exclude: [] })).toEqual([
      'src/App.js',
    ]);
  });

  it('rejects a target that is not a directory', async () => {
    await expect(discoverFiles('/does/not/exist', DEFAULT_SOURCE)).rejects.toThrow(TargetError);
  });
});

describe('extractImports', () => {
  const extract = (text: string, file = 'a.jsx') => extractImports(parseSource(file, text));

  it('reads every import form', () => {
    const { specifiers, hasDynamicImport } = extract(`
      import A from './a';
      import './b.css';
      export { c } from './c';
      const d = import('./d');
      const e = require('./e');
    `);

    expect(specifiers).toEqual(['./a', './b.css', './c', './d', './e']);
    expect(hasDynamicImport).toBe(false);
  });

  it('flags an import that cannot be followed', () => {
    const { specifiers, hasDynamicImport } = extract(
      'const load = (name) => import(`./pages/${name}`);',
    );

    expect(specifiers).toEqual([]);
    expect(hasDynamicImport).toBe(true);
  });

  it('reads JSX in a .js file', () => {
    const { specifiers } = extract(
      'import Card from \'./Card\';\nexport const X = () => <Card title="x" />;',
      'a.js',
    );

    expect(specifiers).toEqual(['./Card']);
  });

  it('lists a specifier once', () => {
    expect(extract("import a from './a';\nimport { b } from './a';").specifiers).toEqual(['./a']);
  });
});

describe('createResolver', () => {
  const project = new Set([
    'src/components/Card.jsx',
    'src/components/index.js',
    'src/components/Card.module.css',
    'src/api/users.js',
    'src/utils/format.ts',
    'src/pages/Home.jsx',
  ]);
  const processed = new Set([
    'src/components/Card.jsx',
    'src/components/index.js',
    'src/api/users.js',
    'src/pages/Home.jsx',
  ]);
  const resolver = createResolver(project, processed, 'src');

  it.each([
    ['../components/Card', 'internal', 'src/components/Card.jsx'],
    ['../components', 'internal', 'src/components/index.js'],
    ['components/Card', 'internal', 'src/components/Card.jsx'],
    ['api/users', 'internal', 'src/api/users.js'],
    ['../utils/format', 'outside', 'src/utils/format.ts'],
    ['../components/Card.module.css', 'asset', 'src/components/Card.module.css'],
  ])('resolves %s from a page as %s', (specifier, kind, path) => {
    expect(resolver.resolve('src/pages/Home.jsx', specifier)).toEqual({ specifier, kind, path });
  });

  it.each([
    ['react-redux', 'package'],
    ['@reduxjs/toolkit', 'package'],
    ['./Missing', 'unresolved'],
    ['./Missing.css', 'unresolved'],
    ['../../../outside', 'unresolved'],
    ['/absolute', 'unresolved'],
  ])('classifies %s as %s', (specifier, kind) => {
    expect(resolver.resolve('src/pages/Home.jsx', specifier)).toEqual({ specifier, kind });
  });

  it('treats a bare specifier as a package when there is no baseUrl', () => {
    expect(
      createResolver(project, processed).resolve('src/pages/Home.jsx', 'components/Card').kind,
    ).toBe('package');
  });
});

describe('readBaseUrl', () => {
  it('reads baseUrl from jsconfig.json with comments', async () => {
    expect(await readBaseUrl(FIXTURE)).toBe('src');
  });

  it('falls back to tsconfig.json', async () => {
    const root = await tempTarget({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": "./src/" } }',
    });

    expect(await readBaseUrl(root)).toBe('src');
  });

  it('is undefined without either file', async () => {
    expect(await readBaseUrl(await tempTarget({ 'package.json': '{}' }))).toBeUndefined();
  });
});

describe('findCycles', () => {
  const graph = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

  it('finds an indirect cycle', () => {
    expect(findCycles(graph({ c: ['a'], a: ['b'], b: ['c'], d: ['a'] }))).toEqual([
      ['a', 'b', 'c'],
    ]);
  });

  it('finds nothing in an acyclic graph', () => {
    expect(findCycles(graph({ a: ['b'], b: ['c'], c: [] }))).toEqual([]);
  });

  it('does not count a self-import', () => {
    expect(findCycles(graph({ a: ['a'] }))).toEqual([]);
  });

  it('handles a 10 000-file chain without overflowing the stack', () => {
    const entries: Record<string, string[]> = {};
    for (let i = 0; i < 10_000; i++) {
      entries[`f${String(i)}`] = i + 1 < 10_000 ? [`f${String(i + 1)}`] : ['f0'];
    }

    const cycles = findCycles(graph(entries));

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(10_000);
  });
});

describe('buildGraph on a CRA fixture', async () => {
  const graph = await buildGraph(FIXTURE, DEFAULT_SOURCE);
  const kinds = (file: string) =>
    Object.fromEntries((graph.imports.get(file) ?? []).map((i) => [i.specifier, i.kind]));

  it('connects files through relative, index and baseUrl imports', () => {
    expect(graph.edges.get('src/pages/Home.jsx')).toEqual([
      'src/components/Card.jsx',
      'src/components/index.js',
    ]);
    expect(graph.edges.get('src/components/Card.jsx')).toEqual(['src/api/users.js']);
    expect(graph.edges.get('src/api/users.js')).toEqual(['src/api/http.js']);
    expect(graph.baseUrl).toBe('src');
  });

  it('classifies every import', () => {
    expect(kinds('src/components/Card.jsx')).toEqual({
      'api/users': 'internal',
      '../utils/format': 'outside',
      './Card.module.css': 'asset',
    });
    expect(kinds('src/pages/Home.jsx')).toMatchObject({
      react: 'package',
      './Missing': 'unresolved',
    });
  });

  it('reports dynamic imports, parse errors and cycles without failing', () => {
    expect(graph.dynamic).toEqual(['src/pages/Lazy.jsx']);
    expect([...graph.parseErrors.keys()]).toEqual(['src/broken.js']);
    expect(graph.edges.get('src/broken.js')).toEqual(['src/api/http.js']);
    expect(graph.cycles).toEqual([['src/cycle/a.js', 'src/cycle/b.js']]);
  });
});
