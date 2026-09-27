import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { countErrors, parseErrors, totalErrors, type ErrorCounts } from './baseline.js';
import type { GateCommand } from '../config/schema.js';
import { formatDuration, formatTokens, type ProgressEvent } from './progress.js';
import { dirname, join } from 'node:path';
import { indexImporters } from '../graph/importers.js';
import { withTestRunner } from '../config/commands.js';
import { ConfigError } from '../config/load.js';
import { STEP_IDS, type ModernizerConfig, type StepId } from '../config/schema.js';
import { buildGraph } from '../graph/build.js';
import { runPool, Scheduler, type Outcome } from '../orchestrator/scheduler.js';
import type { Step, StepRegistry } from '../steps/step.js';
import { expandCommand, runCommand, Semaphore } from './gates.js';
import { openRepository } from './git.js';
import { deleteState, emptyState, loadState, StateStore } from './state.js';
import { processFile } from './transaction.js';
import {
  createWorktrees,
  removeWorktrees,
  worktreeDirectory,
  openRunBranch,
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

/** Which files a run takes: the next `n` in dependency order, every file, or one named file. */
export type FileSelection =
  { kind: 'count'; n: number } | { kind: 'all' } | { kind: 'path'; file: string };

export interface RunOptions {
  config: ModernizerConfig;
  steps: StepRegistry;
  /** Which files to process; every file not yet settled when absent. The `run` command defaults to one. */
  files?: FileSelection;
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
  /** The `--files` count was reached while files remain. */
  limited: boolean;
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

/**
 * Baselines of `newErrorsOnly` gate commands that check the whole project (no `{files}`): taken once, on the fresh
 * worktree at the run branch's tip, and kept in the run directory for a resume at the same tip.
 */
async function takeRunBaselines(
  commands: readonly GateCommand[],
  worktree: Worktree | undefined,
  runDir: string,
  tip: string,
  options: { timeoutSeconds: number; phase: (text: string) => void },
): Promise<Map<string, ErrorCounts>> {
  const baselines = new Map<string, ErrorCounts>();
  if (worktree === undefined) return baselines;
  for (const command of commands) {
    if (command.newErrorsOnly === undefined || command.run.includes('{files}')) continue;
    const id = createHash('sha256').update(command.run).digest('hex').slice(0, 16);
    const path = join(runDir, 'baselines', `${id}-${tip}.json`);
    let counts = await readFile(path, 'utf8').then(
      (text) => JSON.parse(text) as ErrorCounts,
      () => undefined,
    );
    if (counts === undefined) {
      options.phase(`baseline: ${command.run}`);
      const result = await runCommand(
        expandCommand(command.run, [], worktree.cache),
        worktree.cwd,
        options.timeoutSeconds,
        { full: true },
      );
      counts = countErrors(parseErrors(command.newErrorsOnly, result.output, [worktree.cwd]));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(counts));
      await worktree.discardUnstaged();
    }
    options.phase(`baseline: ${command.run} — ${String(totalErrors(counts))} errors already there`);
    baselines.set(command.run, counts);
  }
  return baselines;
}

function describeModel(config: ModernizerConfig): string {
  return config.model.provider === 'ollama'
    ? `${config.model.default} at ${config.model.baseUrl}`
    : `${config.model.default} (Anthropic)`;
}

/** Processes the target file by file; accepted files land on `<current branch>-modernized`, which is checked out. */
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
  const selection = options.files ?? { kind: 'all' };
  if (selection.kind === 'path' && !graph.edges.has(selection.file)) {
    throw new ConfigError(
      (await exists(join(config.target, selection.file)))
        ? `--files ${selection.file}: not selected by source.include/exclude`
        : `--files ${selection.file}: not found in ${config.target}`,
    );
  }
  // Before any file: a step that cannot work (no credentials, unreachable model) stops the run here.
  if (steps.some((s) => s.preflight !== undefined)) {
    phase(`checking model access: ${describeModel(config)}`);
  }
  for (const step of steps) {
    await step.preflight?.();
  }
  const repo = await openRepository(config.target);
  const opened = await openRunBranch(repo, config.target);
  const { branch } = opened;
  const tip = await branch.tip();
  phase(
    opened.created
      ? `branch ${branch.name} (new, from ${opened.current})`
      : `branch ${branch.name} (continued)`,
  );
  if (opened.behind !== undefined && opened.behind.commits > 0) {
    log(
      `${branch.name} is ${String(opened.behind.commits)} commit(s) behind ${opened.behind.original}; ` +
        'merge it if you want them',
    );
  }

  const runDir = runDirectory(repo, branch.name);
  const path = statePath(runDir);
  if (options.fresh === true) {
    await deleteState(path);
  }
  const store = new StateStore(path, (await loadState(path)) ?? emptyState(branch.name, tip));

  // Who imports whom, across the whole project: most importers of a JavaScript file are files the run never
  // processes.
  phase('indexing importers across the project');
  const importers = await indexImporters(config.target, config.source);

  // A named file is processed on its own, again if it was settled before; its record is replaced when it ends.
  const scheduler = new Scheduler(
    selection.kind === 'path' ? new Map([[selection.file, []]]) : graph.edges,
  );
  let resumed = 0;
  for (const [file, record] of Object.entries(store.state.files)) {
    if (selection.kind !== 'path' && graph.edges.has(file)) {
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
    worktreeDirectory(repo, branch.name),
    workers,
    tip,
    join(config.target, 'node_modules'),
  );
  const gateCommands = config.gates.commands.map((c) => ({
    ...c,
    run: withTestRunner(c.run, config.testRunner),
  }));
  const runBaselines = await takeRunBaselines(gateCommands, worktrees[0], runDir, tip, {
    timeoutSeconds: config.gates.timeoutSeconds,
    phase,
  });
  const free: Worktree[] = [...worktrees];
  const semaphore = new Semaphore(config.concurrency.gates ?? workers);
  // An object, not a variable: set inside workers, read after the pool.
  const control = { stopped: false };

  let started = resumed;
  const limit = selection.kind === 'count' ? selection.n : Infinity;
  let begun = 0;
  const work = async (file: string): Promise<Outcome> => {
    begun++;
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
          commands: gateCommands,
          runBaseline: (command) => runBaselines.get(command.run),
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
    await runPool(scheduler, workers, work, {
      shouldStop: () => control.stopped || begun >= limit,
    });
  } finally {
    await removeWorktrees(repo, worktrees);
  }

  const records = graph.files.map((f) => store.state.files[f]);
  const done = records.filter((r) => r?.status === 'done').length;
  const failed = records.filter((r) => r?.status === 'failed').length;
  const summary: RunSummary = {
    branch: branch.name,
    total: graph.files.length,
    done,
    failed,
    remaining: graph.files.length - done - failed,
    stopped: control.stopped,
    limited: false,
  };
  summary.limited = !summary.stopped && begun >= limit && summary.remaining > 0;
  const outcome = summary.stopped
    ? 'stopped'
    : summary.limited
      ? `finished (limit of ${String(limit)} reached)`
      : 'finished';
  log(
    `${outcome}: ${String(done)} done, ${String(failed)} failed, ` +
      `${String(summary.remaining)} remaining — branch ${summary.branch}` +
      (summary.limited ? ' — run again for the next' : ''),
  );
  return summary;
}
