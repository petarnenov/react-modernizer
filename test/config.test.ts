import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  ConfigError,
  loadConfig,
  parseConfig,
  resolveTarget,
} from '../src/config/load.js';
import { withTestRunner } from '../src/config/commands.js';
import { DEFAULT_EXCLUDE } from '../src/config/schema.js';

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

  it('leaves test files out of the default selection', () => {
    const { source } = parseConfig({ target: '.' });

    expect(source.include).toEqual(['src/**/*.{js,jsx}']);
    expect(source.exclude).toEqual(DEFAULT_EXCLUDE);
  });

  it('replaces the default exclude instead of adding to it', () => {
    const { source } = parseConfig({ target: '.', source: { exclude: ['src/legacy/**'] } });

    expect(source.exclude).toEqual(['src/legacy/**']);
  });

  it('defaults the gate timeout', () => {
    const config = parseConfig({ target: '.' });

    expect(config.gates.timeoutSeconds).toBe(600);
    expect(config.gates.commands).toHaveLength(3);
  });

  it('defaults the model, effort and characterize-tests options', () => {
    const config = parseConfig({ target: '.' });

    expect(config.model).toMatchObject({
      provider: 'anthropic',
      default: 'claude-sonnet-5',
      effort: 'high',
    });
    expect(config.steps['characterize-tests']).toMatchObject({
      enabled: true,
      testCommand: '{testRunner} {testFile}',
      helpers: [],
    });
    expect(config.steps['characterize-tests'].model).toBeUndefined();
  });

  it('runs tests through react-scripts by default, everywhere through {testRunner}', () => {
    const config = parseConfig({ target: '.' });

    expect(config.testRunner).toBe('CI=true npx react-scripts test --watchAll=false');
    expect(withTestRunner(config.gates.commands[2]?.run ?? '', config.testRunner)).toBe(
      'CI=true npx react-scripts test --watchAll=false --findRelatedTests {files}',
    );
    expect(config.gates.commands[2]?.newErrorsOnly).toBe('jest');
    expect(config.gates.coverage.min).toBe(80);
  });

  it('lets a project that runs Jest directly change it once', () => {
    const config = parseConfig({
      target: '.',
      testRunner: 'npx jest --ci',
      gates: { coverage: { min: 0 } },
    });

    expect(withTestRunner(config.steps['characterize-tests'].testCommand, config.testRunner)).toBe(
      'npx jest --ci {testFile}',
    );
    expect(config.gates.coverage.min).toBe(0);
  });

  it('lets one step use another model', () => {
    const config = parseConfig({
      target: '.',
      steps: { 'characterize-tests': { model: 'claude-opus-5' } },
    });

    expect(config.steps['characterize-tests'].model).toBe('claude-opus-5');
    expect(config.model.default).toBe('claude-sonnet-5');
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
    [{ gates: { timeoutSeconds: 0 } }, 'timeoutSeconds'],
    [{ model: { effort: 'extreme' } }, 'effort'],
    [{ model: { provider: 'openai' } }, 'provider'],
    [{ model: { provider: 'ollama', apiKey: 'secret' } }, 'apiKey'],
    [{ model: { baseUrl: 'not a url' } }, 'baseUrl'],
    [{ git: { branch: '' } }, 'branch'],
  ])('rejects %j', (partial, mentioned) => {
    expect(() => parseConfig({ target: '.', ...partial })).toThrow(ConfigError);
    expect(() => parseConfig({ target: '.', ...partial })).toThrow(mentioned);
  });

  it('defaults Ollama to gpt-oss:120b on Ollama Cloud with the key from OLLAMA_API_KEY', () => {
    expect(parseConfig({ target: '.', model: { provider: 'ollama' } }).model).toEqual({
      provider: 'ollama',
      default: 'gpt-oss:120b',
      effort: 'high',
      baseUrl: 'https://ollama.com',
      apiKeyEnv: 'OLLAMA_API_KEY',
    });
  });

  it('keeps a model chosen for Ollama', () => {
    const config = parseConfig({
      target: '.',
      model: { provider: 'ollama', default: 'qwen3-coder:480b', baseUrl: 'http://localhost:11434' },
    });

    expect(config.model).toMatchObject({
      default: 'qwen3-coder:480b',
      baseUrl: 'http://localhost:11434',
    });
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

  it('names the file in validation errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modernizer-'));
    const file = join(dir, 'modernizer.config.yaml');
    await writeFile(file, 'target: .\nconcurrency: { workers: 0 }\n');

    await expect(loadConfig(file)).rejects.toThrow(`Invalid config in ${file}:`);
  });

  it('explains a removed option and what to do', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modernizer-'));
    const file = join(dir, 'modernizer.config.yaml');
    await writeFile(
      file,
      'target: .\nsteps:\n  js-to-ts: { enabled: true, codemod: ts-migrate }\n',
    );

    const error = await loadConfig(file).then(
      () => new Error('expected loadConfig to fail'),
      (e: unknown) => e as Error,
    );

    expect(error.message).toContain(
      'steps.js-to-ts.codemod: removed: ts-migrate is no longer used',
    );
    expect(error.message).toContain('delete this line');
  });

  it('explains the removed branch options', () => {
    const error = (() => {
      try {
        parseConfig({ target: '.', git: { branch: 'modernizer/pilot', base: 'HEAD' } });
      } catch (e) {
        return e as Error;
      }
      return new Error('expected parseConfig to fail');
    })();

    expect(error.message).toContain(
      'git.branch: removed: runs commit to `<current branch>-modernized` — delete this line',
    );
    expect(error.message).toContain('git.base: removed: runs start from the current branch');
  });

  it('names the file when the YAML itself is broken', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modernizer-'));
    const file = join(dir, 'modernizer.config.yaml');
    await writeFile(file, 'target: [unclosed\n');

    await expect(loadConfig(file)).rejects.toThrow(`Cannot parse config ${file}`);
  });

  it('resolves a home-relative target against the home directory', () => {
    expect(resolveTarget('~/geowealth/WebContent/react/app', '/etc/cfg', '/Users/pat')).toBe(
      '/Users/pat/geowealth/WebContent/react/app',
    );
    expect(resolveTarget('~', '/etc/cfg', '/Users/pat')).toBe('/Users/pat');
    expect(resolveTarget('./app', '/etc/cfg', '/Users/pat')).toBe('/etc/cfg/app');
    expect(resolveTarget('/abs/app', '/etc/cfg', '/Users/pat')).toBe('/abs/app');
  });

  it('reports a missing file as a config error', async () => {
    await expect(loadConfig('/does/not/exist.yaml')).rejects.toThrow(ConfigError);
  });
});
