import { access } from 'node:fs/promises';
import { formatDuration, formatTokens, type ProgressEvent } from './progress.js';
import { join } from 'node:path';
import { withTestRunner } from '../config/commands.js';
import { ConfigError } from '../config/load.js';
import { STEP_IDS, type ModernizerConfig, type StepId } from '../config/schema.js';
import { buildGraph } from '../graph/build.js';
import { runPool, Scheduler, type Outcome } from '../orchestrator/scheduler.js';
import type { Importer, Step, StepRegistry } from '../steps/step.js';
import { Semaphore } from './gates.js';
import { git, openRepository } from './git.js';
import { deleteState, emptyState, loadState, StateStore } from './state.js';
import { processFile } from './transaction.js';
import {
  createWorktrees,
  removeWorktrees,
  worktreeDirectory,
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
  /** Told what the run is doing as it happens. */
  progress?: (event: ProgressEvent) => void;
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
  const { steps } = config;
  if (
    steps['class-to-function'].enabled &&
    steps['class-to-function'].requireTests &&
    !steps['characterize-tests'].enabled
  ) {
    throw new ConfigError(
      'class-to-function is enabled but characterize-tests is not: components would be converted with no tests ' +
        'pinning their behaviour. Enable characterize-tests, or set steps.class-to-function.requireTests: false.',
    );
  }
  const enabled = STEP_IDS.filter((id) => steps[id].enabled);
  const missing = enabled.filter((id) => registry[id] === undefined);
  if (missing.length > 0) {
    throw new StepsMissingError(missing);
  }
  return enabled.flatMap((id) => registry[id] ?? []);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim() !== '') ?? text;
}

export function statePath(runDir: string): string {
  return join(runDir, 'state.json');
}

function describeModel(config: ModernizerConfig): string {
  return config.model.provider === 'ollama'
    ? `${config.model.default} at ${config.model.baseUrl}`
    : `${config.model.default} (Anthropic)`;
}

/** Processes the target file by file. The user's checkout is never touched; accepted files land on the run branch. */
export async function runModernizer(options: RunOptions): Promise<RunSummary> {
  const { config, log } = options;
  const progress = options.progress ?? (() => undefined);
  const phase = (text: string) => {
    progress({ kind: 'phase', text });
  };
  const steps = resolveSteps(config, options.steps);
  if (config.steps['js-to-ts'].enabled && !(await exists(join(config.target, 'tsconfig.json')))) {
    throw new ConfigError(
      'js-to-ts is enabled but the target has no tsconfig.json. Make the project ready for TypeScript first ' +
        '(allowJs, strict — see "Phase 0" in docs/design.md), or disable js-to-ts.',
    );
  }
  phase('scanning source and building the import graph');
  const graph = await buildGraph(config.target, config.source);
  phase(
    `import graph: ${String(graph.files.length)} files, ${String([...graph.edges.values()].reduce((n, e) => n + e.length, 0))} internal imports`,
  );
  // Before any file: a step that cannot work (no credentials, unreachable model) stops the run here.
  if (steps.some((s) => s.preflight !== undefined)) {
    phase(`checking model access: ${describeModel(config)}`);
  }
  for (const step of steps) {
    await step.preflight?.();
  }
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

  // Who imports whom, for steps that must not break importers.
  const importers = new Map<string, Importer[]>();
  for (const [file, imports] of graph.imports) {
    for (const i of imports) {
      if (i.kind === 'internal' && i.path !== undefined) {
        importers.set(i.path, [...(importers.get(i.path) ?? []), { file, specifier: i.specifier }]);
      }
    }
  }

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
  phase(`preparing ${String(workers)} worktree${workers === 1 ? '' : 's'}`);
  const worktrees = await createWorktrees(
    repo,
    worktreeDirectory(repo, config.git.branch),
    workers,
    tip,
    join(config.target, 'node_modules'),
  );
  const free: Worktree[] = [...worktrees];
  const semaphore = new Semaphore(config.concurrency.gates ?? workers);
  // An object, not a variable: set inside workers, read after the pool.
  const control = { stopped: false };

  let started = resumed;
  const work = async (file: string): Promise<Outcome> => {
    const worktree = free.pop();
    if (worktree === undefined) {
      throw new Error('no free worktree'); // cannot happen: one worktree per worker
    }
    started++;
    progress({ kind: 'file-start', file, index: started, total: graph.files.length });
    const fileStarted = Date.now();
    const cost = (usage: { inputTokens: number; outputTokens: number }) =>
      `(${formatDuration(Date.now() - fileStarted)} · ${formatTokens(usage.inputTokens + usage.outputTokens)} tokens)`;
    try {
      const base = await branch.tip();
      let result = await processFile({
        file,
        worktree,
        base,
        steps,
        gates: {
          commands: config.gates.commands.map((c) => withTestRunner(c, config.testRunner)),
          forbid: config.gates.forbid,
          timeoutSeconds: config.gates.timeoutSeconds,
          semaphore,
          testRunner: config.testRunner,
          coverageMin: config.gates.coverage.min,
          protectTestsFrom: config.gates.protectTestsFrom,
        },
        retries: config.retry.perStep,
        tokenBudget: config.budget.maxTokensPerFile,
        importers: importers.get(file) ?? [],
        progress: (event) => {
          progress({ ...event, file });
        },
      });
      let commit: string | undefined;
      if (result.status === 'done' && result.commit !== undefined) {
        const appended = await branch.append(base, result.commit);
        if (appended.ok) {
          commit = appended.commit;
        } else {
          result = {
            status: 'failed',
            attempts: result.attempts,
            reason: appended.reason,
            usage: result.usage,
            bugs: result.bugs,
          };
        }
      }

      if (result.status === 'done') {
        await store.record(file, {
          status: 'done',
          attempts: result.attempts,
          usage: result.usage,
          ...(commit === undefined ? {} : { commit }),
          ...(result.bugs.length === 0 ? {} : { bugs: result.bugs }),
        });
        log(
          commit === undefined
            ? `· ${file} unchanged ${cost(result.usage)}`
            : `✓ ${file} ${commit.slice(0, 7)} ${cost(result.usage)}`,
        );
        return 'done';
      }
      await store.record(file, {
        status: 'failed',
        attempts: result.attempts,
        reason: result.reason,
        usage: result.usage,
        ...(result.bugs.length === 0 ? {} : { bugs: result.bugs }),
      });
      log(`✗ ${file} ${cost(result.usage)} — ${firstLine(result.reason)}`);
      if (config.retry.onFail === 'stop') {
        control.stopped = true;
      }
      return 'failed';
    } finally {
      progress({ kind: 'file-end', file });
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
