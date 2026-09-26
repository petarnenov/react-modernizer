import type { StepId } from '../config/schema.js';

export interface StepContext {
  /** The file being processed, relative to the target. */
  file: string;
  /** The target's directory inside the worker's worktree; the step changes files here. */
  cwd: string;
  /** 0 for the first attempt, then 1, 2, … for retries. */
  attempt: number;
  /** What the gates reported after the previous attempt, for the step to fix. */
  previousFailure?: string;
}

/** One stage of the per-file pipeline. It changes files in `cwd`; the run decides whether to keep the change. */
export interface Step {
  readonly id: StepId;
  run(context: StepContext): Promise<void>;
}

export type StepRegistry = Partial<Record<StepId, Step>>;

/** The steps that exist. None yet: each arrives in its own change. */
export const builtInSteps: StepRegistry = {};
