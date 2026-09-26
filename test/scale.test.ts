import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_EXCLUDE } from '../src/config/schema.js';
import { buildGraph } from '../src/graph/build.js';

const FILES = 8000;
const PER_DIR = 100;

/** A component in `src/d<n>/C<i>.jsx` importing three earlier components, a stylesheet and a package. */
function component(i: number): string {
  const imports = [1, 7, 131]
    .map((back) => i - back)
    .filter((j) => j >= 0)
    .map(
      (j) => `import C${String(j)} from '../d${String(Math.floor(j / PER_DIR))}/C${String(j)}';`,
    );
  return [
    "import React from 'react';",
    ...imports,
    `import './C${String(i)}.css';`,
    '',
    `export default function C${String(i)}({ items }) {`,
    '  return <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>;',
    '}',
    '',
  ].join('\n');
}

it(
  `builds the graph of ${String(FILES)} files within 30 seconds`,
  { timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'modernizer-scale-'));
    for (let d = 0; d < FILES / PER_DIR; d++) {
      await mkdir(join(root, 'src', `d${String(d)}`), { recursive: true });
    }
    await Promise.all(
      Array.from({ length: FILES }, (_, i) =>
        Promise.all([
          writeFile(
            join(root, 'src', `d${String(Math.floor(i / PER_DIR))}`, `C${String(i)}.jsx`),
            component(i),
          ),
          writeFile(
            join(root, 'src', `d${String(Math.floor(i / PER_DIR))}`, `C${String(i)}.css`),
            '',
          ),
        ]),
      ),
    );

    const started = performance.now();
    const graph = await buildGraph(root, {
      include: ['src/**/*.{js,jsx}'],
      exclude: DEFAULT_EXCLUDE,
    });
    const seconds = (performance.now() - started) / 1000;

    expect(graph.files).toHaveLength(FILES);
    expect(graph.edges.get('src/d79/C7999.jsx')).toHaveLength(3);
    expect(graph.cycles).toEqual([]);
    expect(seconds).toBeLessThan(30);
  },
);
