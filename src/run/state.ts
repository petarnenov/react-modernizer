import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UsageTotals } from '../model/usage.js';
import type { Outcome } from '../orchestrator/scheduler.js';
import type { BugReport } from '../steps/step.js';

export interface FileRecord {
  status: Outcome;
  attempts: number;
  /** The commit on the run branch, when the file changed. */
  commit?: string;
  /** Why the file failed. */
  reason?: string;
  /** Tokens the file's model steps used, failed attempts included. */
  usage?: UsageTotals;
  /** Suspected bugs the steps reported. */
  bugs?: BugReport[];
  updatedAt: string;
}

export interface RunState {
  version: 1;
  branch: string;
  base: string;
  files: Record<string, FileRecord>;
}

export class StateError extends Error {
  override readonly name = 'StateError';
}

export function emptyState(branch: string, base: string): RunState {
  return { version: 1, branch, base, files: {} };
}

export async function loadState(path: string): Promise<RunState | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  const parsed = JSON.parse(text) as Partial<RunState>;
  if (parsed.version !== 1 || typeof parsed.files !== 'object') {
    throw new StateError(`Unrecognised state file ${path}; run with --fresh to start over`);
  }
  return parsed as RunState;
}

/** Writes the whole state to a temporary file and renames it over the old one, so a crash never corrupts it. */
export async function saveState(path: string, state: RunState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, path);
}

export async function deleteState(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Records file outcomes and saves after each one; saves are serialised so workers never interleave writes. */
export class StateStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    readonly state: RunState,
  ) {}

  record(file: string, record: Omit<FileRecord, 'updatedAt'>): Promise<void> {
    this.state.files[file] = { ...record, updatedAt: new Date().toISOString() };
    const snapshot = structuredClone(this.state);
    // A failed save is reported to its caller and does not block the saves after it.
    const save = this.queue.catch(() => undefined).then(() => saveState(this.path, snapshot));
    this.queue = save;
    return save;
  }
}
