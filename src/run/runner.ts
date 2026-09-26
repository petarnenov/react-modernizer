import { join } from 'node:path';
import { STEP_IDS, type ModernizerConfig, type StepId } from '../config/schema.js';
import { buildGraph } from '../graph/build.js';
import { runPool, Scheduler, type Outcome } from '../orchestrator/scheduler.js';
import type { Step, StepRegistry } from '../steps/step.js';
import { Semaphore } from './gates.js';
import { git, openRepository } from './git.js';
import { deleteState, emptyState, loadState, StateStore } from './state.js';
import { processFile } from './transaction.js';
import {
  createWorktrees,
  removeWorktrees,
  RunBranch,
  runDirectory,
  type Worktree,
} from './workspace.js';

export class StepsMissingError extends Error {
  override readonly name = 'StepsMissingError';
  constructor(readonly missing: readonly StepId[]) {
    super(
      `Enabled step(s) not implemented yet: ${missing.join(', ')}. ` +
        'Disable them under `steps` in the config (with every step disabled, run checks the gates only).',
    );
  }
}

export interface RunOptions {
  config: ModernizerConfig;
  steps: StepRegistry;
  /** Discard the saved state and process every file again. */
  fresh?: boolean;
  log: (line: string) => void;
}

export interface RunSummary {
  branch: string;
  total: number;
  done: number;
  failed: number;
  remaining: number;
  stopped: boolean;
}

/** The enabled steps in pipeline order; refuses to go on while one has no implementation. */
export function resolveSteps(config: ModernizerConfig, registry: StepRegistry): Step[] {
  const enabled = STEP_IDS.filter((id) => config.steps[id].enabled);
  const missing = enabled.filter((id) => registry[id] === undefined);
  if (missing.length > 0) {
    throw new StepsMissingError(missing);
  }
  return enabled.flatMap((id) => registry[id] ?? []);
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim() !== '') ?? text;
}

export function statePath(runDir: string): string {
  return join(runDir, 'state.json');
}

/** Processes the target file by file. The user's checkout is never touched; accepted files land on the run branch. */
export async function runModernizer(options: RunOptions): Promise<RunSummary> {
  const { config, log } = options;
  const steps = resolveSteps(config, options.steps);
  const graph = await buildGraph(config.target, config.source);
  const repo = await openRepository(config.target);

  const dirty = await git(config.target, ['status', '--porcelain', '--', '.']);
  if (dirty.stdout.trim() !== '') {
    log(
      'warning: the target has uncommitted changes; the run starts from the committed base, not from them',
    );
  }

  const runDir = runDirectory(repo, config.git.branch);
  const path = statePath(runDir);
  if (options.fresh === true) {
    await deleteState(path);
  }
  const store = new StateStore(
    path,
    (await loadState(path)) ?? emptyState(config.git.branch, config.git.base),
  );

  const branch = new RunBranch(repo, config.git.branch);
  const tip = await branch.ensure(config.git.base);

  const scheduler = new Scheduler(graph.edges);
  let resumed = 0;
  for (const [file, record] of Object.entries(store.state.files)) {
    if (graph.edges.has(file)) {
      scheduler.settle(file, record.status);
      resumed++;
    }
  }
  if (resumed > 0) {
    log(`resuming: ${String(resumed)} file(s) already settled`);
  }

  const workers = config.concurrency.workers;
  const worktrees = await createWorktrees(
    repo,
    runDir,
    workers,
    tip,
    join(config.target, 'node_modules'),
  );
  const free: Worktree[] = [...worktrees];
  const semaphore = new Semaphore(config.concurrency.gates ?? workers);
  // An object, not a variable: set inside workers, read after the pool.
  const control = { stopped: false };

  const work = async (file: string): Promise<Outcome> => {
    const worktree = free.pop();
    if (worktree === undefined) {
      throw new Error('no free worktree'); // cannot happen: one worktree per worker
    }
    try {
      const base = await branch.tip();
      let result = await processFile({
        file,
        worktree,
        base,
        steps,
        gates: {
          commands: config.gates.commands,
          forbid: config.gates.forbid,
          timeoutSeconds: config.gates.timeoutSeconds,
          semaphore,
        },
        retries: config.retry.perStep,
      });
      let commit: string | undefined;
      if (result.status === 'done' && result.commit !== undefined) {
        const appended = await branch.append(base, result.commit);
        if (appended.ok) {
          commit = appended.commit;
        } else {
          result = { status: 'failed', attempts: result.attempts, reason: appended.reason };
        }
      }

      if (result.status === 'done') {
        await store.record(file, {
          status: 'done',
          attempts: result.attempts,
          ...(commit === undefined ? {} : { commit }),
        });
        log(commit === undefined ? `· ${file} (unchanged)` : `✓ ${file} ${commit.slice(0, 7)}`);
        return 'done';
      }
      await store.record(file, {
        status: 'failed',
        attempts: result.attempts,
        reason: result.reason,
      });
      log(`✗ ${file} — ${firstLine(result.reason)}`);
      if (config.retry.onFail === 'stop') {
        control.stopped = true;
      }
      return 'failed';
    } finally {
      free.push(worktree);
    }
  };

  try {
    await runPool(scheduler, workers, work, { shouldStop: () => control.stopped });
  } finally {
    await removeWorktrees(repo, worktrees);
  }

  const records = graph.files.map((f) => store.state.files[f]);
  const done = records.filter((r) => r?.status === 'done').length;
  const failed = records.filter((r) => r?.status === 'failed').length;
  const summary: RunSummary = {
    branch: config.git.branch,
    total: graph.files.length,
    done,
    failed,
    remaining: graph.files.length - done - failed,
    stopped: control.stopped,
  };
  log(
    `${summary.stopped ? 'stopped' : 'finished'}: ${String(done)} done, ${String(failed)} failed, ` +
      `${String(summary.remaining)} remaining — branch ${summary.branch}`,
  );
  return summary;
}
