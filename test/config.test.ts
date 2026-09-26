import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyOverrides, ConfigError, loadConfig, parseConfig } from '../src/config/load.js';

describe('parseConfig', () => {
  it('fills every default from a minimal config', () => {
    const config = parseConfig({ target: '../app' });

    expect(config.concurrency.workers).toBe(1);
    expect(config.concurrency.gates).toBe(1);
    expect(config.order).toBe('dependency-graph');
    expect(config.steps['redux-connect-to-hooks'].enabled).toBe(false);
    expect(config.steps['class-to-function'].skip).toEqual(['error-boundary']);
    expect(config.gates.protectTestsFrom).toBe('characterize-tests');
  });

  it('keeps gate concurrency when set apart from workers', () => {
    const config = parseConfig({ target: '.', concurrency: { workers: 8, gates: 2 } });

    expect(config.concurrency).toMatchObject({ workers: 8, gates: 2 });
  });

  it.each([
    [{ concurrency: { workers: 0 } }, 'workers'],
    [{ concurrency: { workers: 1.5 } }, 'workers'],
    [{ steps: { 'no-such-step': {} } }, 'no-such-step'],
    [{ gates: { coverage: { min: 120 } } }, 'min'],
    [{ unknownKey: true }, 'unknownKey'],
  ])('rejects %j', (partial, mentioned) => {
    expect(() => parseConfig({ target: '.', ...partial })).toThrow(ConfigError);
    expect(() => parseConfig({ target: '.', ...partial })).toThrow(mentioned);
  });

  it('requires a target', () => {
    expect(() => parseConfig({})).toThrow(/target/);
  });
});

describe('applyOverrides', () => {
  it('moves gates with workers when they were equal', () => {
    const config = applyOverrides(parseConfig({ target: '.' }), { workers: 4 });

    expect(config.concurrency).toMatchObject({ workers: 4, gates: 4 });
  });

  it('keeps gates the file set apart', () => {
    const base = parseConfig({ target: '.', concurrency: { workers: 2, gates: 1 } });

    expect(applyOverrides(base, { workers: 8 }).concurrency).toMatchObject({
      workers: 8,
      gates: 1,
    });
  });

  it('validates the override', () => {
    expect(() => applyOverrides(parseConfig({ target: '.' }), { workers: 0 })).toThrow(ConfigError);
  });
});

describe('loadConfig', () => {
  it('resolves target against the config file directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modernizer-'));
    const file = join(dir, 'modernizer.config.yaml');
    await writeFile(file, 'target: ./app\nconcurrency:\n  workers: 3\n');

    const config = await loadConfig(file);

    expect(config.target).toBe(join(dir, 'app'));
    expect(config.concurrency.workers).toBe(3);
  });

  it('reports a missing file as a config error', async () => {
    await expect(loadConfig('/does/not/exist.yaml')).rejects.toThrow(ConfigError);
  });
});
