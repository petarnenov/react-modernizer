import type { Step } from '../steps/step.js';
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
}

export type FileResult =
  | { status: 'done'; attempts: number; commit?: string; steps: string[] }
  | { status: 'failed'; attempts: number; reason: string };

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
 * Takes one file through the steps, with the gates after each step and retries that see the previous failure.
 * Either every step passes and the change is committed in the worktree, or the worktree is reset and the file
 * fails with the reason. Never touches the run branch — the caller merges the commit.
 */
export async function processFile(job: FileJob): Promise<FileResult> {
  await job.worktree.reset(job.base);
  let attempts = 0;

  if (job.steps.length === 0) {
    attempts = 1;
    const result = await check(job);
    return result.ok
      ? { status: 'done', attempts, steps: [] }
      : { status: 'failed', attempts, reason: describe(result) };
  }

  for (const step of job.steps) {
    let previousFailure: string | undefined;
    let passed = false;
    for (let attempt = 0; attempt <= job.retries && !passed; attempt++) {
      attempts++;
      try {
        await step.run({
          file: job.file,
          cwd: job.worktree.cwd,
          attempt,
          ...(previousFailure === undefined ? {} : { previousFailure }),
        });
        const result = await check(job);
        if (result.ok) {
          passed = true;
        } else {
          previousFailure = describe(result);
        }
      } catch (error) {
        previousFailure = `${step.id} threw: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (!passed) {
      await job.worktree.reset(job.base);
      return {
        status: 'failed',
        attempts,
        reason: `${step.id}: ${previousFailure ?? 'failed'}`,
      };
    }
  }

  const ids = job.steps.map((s) => s.id);
  await job.worktree.stage();
  const commit = await job.worktree.commit(`modernize: ${job.file}\n\nSteps: ${ids.join(', ')}`);
  return commit === undefined
    ? { status: 'done', attempts, steps: ids }
    : { status: 'done', attempts, commit, steps: ids };
}
