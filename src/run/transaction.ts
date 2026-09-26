import { UsageMeter, type UsageTotals } from '../model/usage.js';
import type { BugReport, Step } from '../steps/step.js';
import { findForbidden, runGateCommands, type GateResult, type Semaphore } from './gates.js';
import type { Worktree } from './workspace.js';

export interface GateSettings {
  commands: readonly string[];
  forbid: readonly string[];
  timeoutSeconds: number;
  semaphore: Semaphore;
}

export interface FileJob {
  file: string;
  worktree: Worktree;
  /** The run-branch commit the file starts from. */
  base: string;
  steps: readonly Step[];
  gates: GateSettings;
  /** Retries per step after the first attempt. */
  retries: number;
  /** Tokens the file's steps may use in total (`budget.maxTokensPerFile`). */
  tokenBudget?: number;
}

interface Findings {
  usage: UsageTotals;
  bugs: BugReport[];
}

export type FileResult =
  | ({ status: 'done'; attempts: number; commit?: string; steps: string[] } & Findings)
  | ({ status: 'failed'; attempts: number; reason: string } & Findings);

function describe(result: Exclude<GateResult, { ok: true }>): string {
  return `${result.gate} failed:\n${result.output.trim()}`;
}

/** Stages the step's output and runs the gates on it. */
async function check(job: FileJob): Promise<GateResult> {
  const changed = await job.worktree.stage();
  const present = changed.filter((c) => c.status !== 'D').map((c) => c.path);
  const commands = await runGateCommands({
    commands: job.gates.commands,
    cwd: job.worktree.cwd,
    files: present.length > 0 ? present : [job.file],
    timeoutSeconds: job.gates.timeoutSeconds,
    semaphore: job.gates.semaphore,
  });
  if (!commands.ok) {
    return commands;
  }
  return findForbidden(await job.worktree.stagedDiff(), job.gates.forbid);
}

/**
 * Changes the step made outside what it may change are put back and reported. The step's tools should make this
 * impossible; this makes it impossible even for a step with a bug.
 */
async function outsideAllowed(job: FileJob, step: Step): Promise<string | undefined> {
  if (step.allowedChanges === undefined) {
    return undefined;
  }
  const allowed = new Set(step.allowedChanges(job.file));
  const outside = (await job.worktree.unstagedChanges()).filter((path) => !allowed.has(path));
  if (outside.length === 0) {
    return undefined;
  }
  await job.worktree.restore(outside);
  return `${step.id} changed files it may not change (put back): ${outside.join(', ')}`;
}

/**
 * Takes one file through the steps, with the gates after each step and retries that see the previous failure.
 * Either every step passes and the change is committed in the worktree, or the worktree is reset and the file
 * fails with the reason. Never touches the run branch — the caller merges the commit. Token usage and reported
 * bugs are returned either way.
 */
export async function processFile(job: FileJob): Promise<FileResult> {
  await job.worktree.reset(job.base);
  const meter = new UsageMeter(job.tokenBudget);
  const bugs: BugReport[] = [];
  const findings = (): Findings => ({ usage: meter.totals(), bugs });
  let attempts = 0;

  if (job.steps.length === 0) {
    attempts = 1;
    const result = await check(job);
    return result.ok
      ? { status: 'done', attempts, steps: [], ...findings() }
      : { status: 'failed', attempts, reason: describe(result), ...findings() };
  }

  for (const step of job.steps) {
    let previousFailure: string | undefined;
    let passed = false;
    // Staged here, so unstaged changes after the step are exactly what the step did.
    await job.worktree.stage();
    for (let attempt = 0; attempt <= job.retries && !passed && !meter.exhausted; attempt++) {
      attempts++;
      try {
        await step.run({
          file: job.file,
          cwd: job.worktree.cwd,
          attempt,
          usage: meter,
          report: (bug) => bugs.push(bug),
          ...(previousFailure === undefined ? {} : { previousFailure }),
        });
        const outside = await outsideAllowed(job, step);
        if (outside !== undefined) {
          previousFailure = outside;
          continue;
        }
        const result = await check(job);
        if (result.ok) {
          passed = true;
        } else {
          previousFailure = describe(result);
        }
      } catch (error) {
        const outside = await outsideAllowed(job, step);
        previousFailure =
          `${step.id} threw: ${error instanceof Error ? error.message : String(error)}` +
          (outside === undefined ? '' : `\n${outside}`);
      }
    }
    if (!passed) {
      await job.worktree.reset(job.base);
      return {
        status: 'failed',
        attempts,
        reason: `${step.id}: ${previousFailure ?? 'failed'}`,
        ...findings(),
      };
    }
  }

  const ids = job.steps.map((s) => s.id);
  await job.worktree.stage();
  const commit = await job.worktree.commit(`modernize: ${job.file}\n\nSteps: ${ids.join(', ')}`);
  return commit === undefined
    ? { status: 'done', attempts, steps: ids, ...findings() }
    : { status: 'done', attempts, commit, steps: ids, ...findings() };
}
