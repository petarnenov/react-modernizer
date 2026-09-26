import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { DEFAULT_EXCLUDE } from '../src/config/schema.js';
import { buildGraph } from '../src/graph/build.js';
import { createPlan, renderPlan, type Plan } from '../src/plan.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cra-app');

async function run(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr };
}

async function configFor(target: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'modernizer-plan-'));
  const file = join(dir, 'modernizer.config.yaml');
  await writeFile(file, `target: ${JSON.stringify(target)}\n`);
  return file;
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const hash = async (file: string): Promise<[string, string]> => [
    file,
    createHash('sha256')
      .update(await readFile(join(root, file)))
      .digest('hex'),
  ];
  const files = await glob(['**/*'], { cwd: root, dot: true });
  const entries = await Promise.all(files.map(hash));
  return Object.fromEntries(entries);
}

describe('createPlan', async () => {
  const plan = createPlan(
    FIXTURE,
    await buildGraph(FIXTURE, { include: ['src/**/*.{js,jsx}'], exclude: DEFAULT_EXCLUDE }),
  );
  const position = (file: string) => plan.order.indexOf(file);

  it('orders every file after the files it imports', () => {
    expect(position('src/api/http.js')).toBeLessThan(position('src/api/users.js'));
    expect(position('src/api/users.js')).toBeLessThan(position('src/components/Card.jsx'));
    expect(position('src/components/Card.jsx')).toBeLessThan(position('src/pages/Home.jsx'));
    expect(position('src/pages/Home.jsx')).toBeLessThan(position('src/App.jsx'));
    expect(position('src/App.jsx')).toBeLessThan(position('src/index.js'));
    expect(new Set(plan.order).size).toBe(plan.stats.files);
    expect(plan.order).toHaveLength(11);
  });

  it('reports the problems of the codebase', () => {
    expect(plan.unresolved).toEqual([{ file: 'src/pages/Home.jsx', specifier: './Missing' }]);
    expect(plan.cycles).toEqual([['src/cycle/a.js', 'src/cycle/b.js']]);
    expect(plan.dynamic).toEqual(['src/pages/Lazy.jsx']);
    expect(plan.parseErrors.map((p) => p.file)).toEqual(['src/broken.js']);
    expect(plan.stats.imports).toMatchObject({ unresolved: 1, outside: 1 });
    expect(plan.stats.leaves).toBe(2);
  });

  it('renders every section as text', () => {
    const text = renderPlan(plan);

    expect(text).toContain('Files: 11');
    expect(text).toContain('src/pages/Home.jsx  ./Missing');
    expect(text).toContain('src/cycle/a.js → src/cycle/b.js');
    expect(text).toContain('Could not be parsed (1)');
  });
});

describe('plan command', () => {
  it('prints one JSON document with paths relative to the target', async () => {
    const { code, stdout } = await run('plan', await configFor(FIXTURE), '--json');
    const plan = JSON.parse(stdout) as Plan;

    expect(code).toBe(0);
    expect(plan.order).toContain('src/components/Card.jsx');
    expect(plan.order.every((f) => !f.startsWith('/'))).toBe(true);
  });

  it('exits zero despite unresolved imports and cycles', async () => {
    const { code, stdout } = await run('plan', await configFor(FIXTURE));

    expect(code).toBe(0);
    expect(stdout).toContain('Unresolved imports (1)');
    expect(stdout).toContain('Cycles (1)');
  });

  it('exits non-zero when the target does not exist', async () => {
    const { code, stderr } = await run('plan', await configFor('/does/not/exist'));

    expect(code).toBe(1);
    expect(stderr).toContain('/does/not/exist');
  });

  it('exits non-zero on an invalid config', async () => {
    const config = await configFor(FIXTURE);
    await writeFile(config, 'target: .\nconcurrency: { workers: 0 }\n');

    expect((await run('plan', config)).code).toBe(1);
  });

  it('does not change the target', async () => {
    const before = await snapshotTree(FIXTURE);
    await run('plan', await configFor(FIXTURE));

    expect(await snapshotTree(FIXTURE)).toEqual(before);
  });
});

describe('cli', () => {
  it('rejects a non-positive --workers', async () => {
    expect((await run('check-config', await configFor(FIXTURE), '--workers', '0')).code).not.toBe(
      0,
    );
  });

  it('refuses run on a target that is not ready for TypeScript', async () => {
    const result = await run('run', await configFor(FIXTURE));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no tsconfig.json');
  });
});
