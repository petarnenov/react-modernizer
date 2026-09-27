import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOwnFilesTool } from '../src/steps/shared/tools.js';

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modernizer-tools-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/Card.jsx'), 'card');
  await writeFile(join(root, 'src/Page.jsx'), 'page');
  return root;
}

const read = (root: string, path: string) =>
  readOwnFilesTool(root, ['src/Card.jsx', 'src/Card.test.js']).run({ path } as never);

describe('readOwnFilesTool', () => {
  it('reads an allowed file, also when written with ./', async () => {
    const root = await project();
    expect(await read(root, 'src/Card.jsx')).toBe('card');
    expect(await read(root, './src/Card.jsx')).toBe('card');
  });

  it('refuses another project file, naming the files it can read', async () => {
    const root = await project();
    await expect(read(root, 'src/Page.jsx')).rejects.toThrow(
      'only these files can be read: src/Card.jsx, src/Card.test.js',
    );
  });

  it('still refuses paths outside the project', async () => {
    const root = await project();
    await expect(read(root, '../src/Card.jsx')).rejects.toThrow('outside the project');
  });
});
