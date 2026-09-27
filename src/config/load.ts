import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { configSchema, type ModernizerConfig } from './schema.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Options the tool used to accept, and what to do about each now. */
const REMOVED_OPTIONS: Record<string, string> = {
  'steps.js-to-ts.codemod':
    'removed: ts-migrate is no longer used, because it inserts `any` and `@ts-expect-error` — delete this line',
  'git.branch': 'removed: runs commit to `<current branch>-modernized` — delete this line',
  'git.base': 'removed: runs start from the current branch — delete this line',
};

function valueAt(raw: unknown, path: string): unknown {
  let node = raw;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(key in node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * Validates raw config data. Throws {@link ConfigError} listing every problem with its path, naming `source` (the
 * file) when given, with a hint for each option that was removed.
 */
export function parseConfig(raw: unknown, source?: string): ModernizerConfig {
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    const hints = Object.entries(REMOVED_OPTIONS)
      .filter(([path]) => valueAt(raw, path) !== undefined)
      .map(([path, hint]) => `  ${path}: ${hint}`);
    throw new ConfigError(
      `Invalid config${source === undefined ? '' : ` in ${source}`}:\n${z.prettifyError(result.error)}` +
        (hints.length === 0 ? '' : `\n\nRemoved options:\n${hints.join('\n')}`),
    );
  }
  const config = result.data;
  config.concurrency.gates ??= config.concurrency.workers;
  return config;
}

/** `~` and `~/…` are the home directory (YAML does not expand them); other relative paths are the config's directory. */
export function resolveTarget(
  target: string,
  configDirectory: string,
  home: string = homedir(),
): string {
  if (target === '~') return home;
  if (target.startsWith('~/')) return join(home, target.slice(2));
  return resolve(configDirectory, target);
}

/** Reads a YAML config file; `target` is resolved against the file's directory, or the home directory for `~`. */
export async function loadConfig(path: string): Promise<ModernizerConfig> {
  const absolute = resolve(path);
  let text: string;
  try {
    text = await readFile(absolute, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read config ${absolute}: ${(error as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new ConfigError(`Cannot parse config ${absolute}: ${(error as Error).message}`);
  }
  const config = parseConfig(raw, absolute);
  config.target = resolveTarget(config.target, dirname(absolute));
  return config;
}

/** Command-line values that take precedence over the file. */
export interface ConfigOverrides {
  workers?: number;
  /** Replaces `model.default` for this run. */
  model?: string;
}

export function applyOverrides(
  config: ModernizerConfig,
  overrides: ConfigOverrides,
): ModernizerConfig {
  if (overrides.model !== undefined) {
    config = parseConfig({ ...config, model: { ...config.model, default: overrides.model } });
  }
  if (overrides.workers === undefined) {
    return config;
  }
  const { workers, gates } = config.concurrency;
  // Gates follow workers unless the file set them apart. Re-validated so an override obeys the file's limits.
  return parseConfig({
    ...config,
    concurrency: {
      ...config.concurrency,
      workers: overrides.workers,
      gates: gates === workers ? overrides.workers : gates,
    },
  });
}
