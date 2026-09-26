import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { configSchema, type ModernizerConfig } from './schema.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Validates raw config data. Throws {@link ConfigError} listing every problem with its path. */
export function parseConfig(raw: unknown): ModernizerConfig {
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new ConfigError(`Invalid config:\n${z.prettifyError(result.error)}`);
  }
  const config = result.data;
  config.concurrency.gates ??= config.concurrency.workers;
  return config;
}

/** Reads a YAML config file; `target` is resolved against the file's directory. */
export async function loadConfig(path: string): Promise<ModernizerConfig> {
  const absolute = resolve(path);
  let text: string;
  try {
    text = await readFile(absolute, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read config ${absolute}: ${(error as Error).message}`);
  }
  const config = parseConfig(parse(text));
  config.target = resolve(dirname(absolute), config.target);
  return config;
}

/** Command-line values that take precedence over the file. */
export interface ConfigOverrides {
  workers?: number;
}

export function applyOverrides(
  config: ModernizerConfig,
  overrides: ConfigOverrides,
): ModernizerConfig {
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
