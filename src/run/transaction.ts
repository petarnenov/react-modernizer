import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StepId } from '../config/schema.js';
import { UsageMeter, type UsageTotals } from '../model/usage.js';
import type { BugReport, Step } from '../steps/step.js';
import { coverageGate } from './coverage.js';
import { findForbidden, runGateCommands, type GateResult, type Semaphore } from './gates.js';
import { countTests, weakening, type TestCounts } from './protection.js';
import { locate, renamedTo } from './tracking.js';
import type { Worktree } from './workspace.js';

export interface GateSettings {
  commands: readonly string[];
  forbid: readonly string[];
  timeoutSeconds: number;
  semaphore: Semaphore;
  /** The target's test runner, for the coverage gate. */
  testRunner: string;
  /** Minimum line coverage of the file by its produced tests; 0 turns the gate off. */
  coverageMin: number;
  /** Tests written by this step are protected from later steps; null protects nothing. */
  protectTestsFrom: StepId | null;
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

/** What the pipeline knows about the file as its steps change it. */
interface Pipeline {
  /** Where the file is now; steps may rename it (`.jsx` → `.tsx`). */
  current: string;
  /** Test files steps produced for it, as they named them; found again by name after renames. */
  produced: string[];
  /** Counts of protected tests, recorded when the protecting step passed. */
  protected: { path: string; counts: TestCounts }[];
}

function describe(result: Exclude<GateResult, { ok: true }>): string {
  return `${result.gate} failed:\n${result.output.trim()}`;
}

async function checkProtection(job: FileJob, pipeline: Pipeline): Promise<GateResult> {
  for (const { path, counts } of pipeline.protected) {
    const now = await locate(job.worktree.cwd, path);
    if (now === undefined) {
      return { ok: false, gate: 'test protection', output: `protected tests ${path} were deleted` };
    }
    const problem = weakening(
      now,
      counts,
      countTests(now, await readFile(join(job.worktree.cwd, now), 'utf8')),
    );
    if (problem !== undefined) {
      return { ok: false, gate: 'test protection', output: problem };
    }
  }
  return { ok: true };
}

/**
 * Stages the step's output and checks it, cheapest and most definitive first: test protection, gate commands,
 * forbidden patterns, then coverage by the file's produced tests.
 */
async function check(
  job: FileJob,
  pipeline: Pipeline,
  producing: readonly string[],
): Promise<GateResult> {
  const { cwd } = job.worktree;
  const changed = await job.worktree.stage();
  pipeline.current =
    renamedTo(changed, job.file) ?? (await locate(cwd, pipeline.current)) ?? pipeline.current;

  const protection = await checkProtection(job, pipeline);
  if (!protection.ok) {
    return protection;
  }
  const present = changed.filter((c) => c.status !== 'D').map((c) => c.path);
  const commands = await runGateCommands({
    commands: job.gates.commands,
    cwd,
    files: present.length > 0 ? present : [pipeline.current],
    timeoutSeconds: job.gates.timeoutSeconds,
    semaphore: job.gates.semaphore,
  });
  if (!commands.ok) {
    return commands;
  }
  const forbidden = findForbidden(await job.worktree.stagedDiff(), job.gates.forbid);
  if (!forbidden.ok || job.gates.coverageMin <= 0) {
    return forbidden;
  }
  const tests: string[] = [];
  for (const path of [...pipeline.produced, ...producing]) {
    const now = await locate(cwd, path);
    if (now !== undefined && !tests.includes(now)) tests.push(now);
  }
  if (tests.length === 0) {
    return { ok: true };
  }
  return coverageGate({
    testRunner: job.gates.testRunner,
    cwd,
    file: pipeline.current,
    tests,
    min: job.gates.coverageMin,
    timeoutSeconds: job.gates.timeoutSeconds,
    semaphore: job.gates.semaphore,
  });
}

/**
 * Changes the step made outside what it may change are put back and reported. The step's tools should make this
 * impossible; this makes it impossible even for a step with a bug.
 */
async function outsideAllowed(job: FileJob, step: Step, file: string): Promise<string | undefined> {
  if (step.allowedChanges === undefined) {
    return undefined;
  }
  const allowed = new Set(step.allowedChanges(file));
  const outside = (await job.worktree.unstagedChanges()).filter((path) => !allowed.has(path));
  if (outside.length === 0) {
    return undefined;
  }
  await job.worktree.restore(outside);
  return `${step.id} changed files it may not change (put back): ${outside.join(', ')}`;
}

async function recordProtected(
  job: FileJob,
  pipeline: Pipeline,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    const now = await locate(job.worktree.cwd, path);
    if (now !== undefined) {
      const counts = countTests(now, await readFile(join(job.worktree.cwd, now), 'utf8'));
      pipeline.protected.push({ path, counts });
    }
  }
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
  const pipeline: Pipeline = { current: job.file, produced: [], protected: [] };
  let attempts = 0;

  if (job.steps.length === 0) {
    attempts = 1;
    const result = await check(job, pipeline, []);
    return result.ok
      ? { status: 'done', attempts, steps: [], ...findings() }
      : { status: 'failed', attempts, reason: describe(result), ...findings() };
  }

  for (const step of job.steps) {
    const file = pipeline.current;
    const producing = step.producesTests?.(file) ?? [];
    let previousFailure: string | undefined;
    let passed = false;
    // Staged here, so unstaged changes after the step are exactly what the step did.
    await job.worktree.stage();
    for (let attempt = 0; attempt <= job.retries && !passed && !meter.exhausted; attempt++) {
      attempts++;
      try {
        await step.run({
          file,
          cwd: job.worktree.cwd,
          attempt,
          usage: meter,
          report: (bug) => bugs.push(bug),
          ...(previousFailure === undefined ? {} : { previousFailure }),
        });
        const outside = await outsideAllowed(job, step, file);
        if (outside !== undefined) {
          previousFailure = outside;
          continue;
        }
        const result = await check(job, pipeline, producing);
        if (result.ok) {
          passed = true;
        } else {
          previousFailure = describe(result);
        }
      } catch (error) {
        const outside = await outsideAllowed(job, step, file);
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
    pipeline.produced.push(...producing);
    if (step.id === job.gates.protectTestsFrom) {
      await recordProtected(job, pipeline, producing);
    }
  }

  const ids = job.steps.map((s) => s.id);
  await job.worktree.stage();
  const commit = await job.worktree.commit(`modernize: ${job.file}\n\nSteps: ${ids.join(', ')}`);
  return commit === undefined
    ? { status: 'done', attempts, steps: ids, ...findings() }
    : { status: 'done', attempts, commit, steps: ids, ...findings() };
}
