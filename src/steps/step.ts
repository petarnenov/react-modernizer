import type { StepId } from '../config/schema.js';
import type { UsageMeter } from '../model/usage.js';

/** A suspected bug a step noticed; recorded, never fixed. */
export interface BugReport {
  /** 1-based line in the file, when the step can point at one. */
  line?: number;
  reason: string;
}

export interface StepContext {
  /** The file being processed, relative to the target. */
  file: string;
  /** The target's directory inside the worker's worktree; the step changes files here. */
  cwd: string;
  /** 0 for the first attempt, then 1, 2, … for retries. */
  attempt: number;
  /** What the gates reported after the previous attempt, for the step to fix. */
  previousFailure?: string;
  /** The file's token meter, shared by every step and attempt; enforces the per-file budget. */
  usage: UsageMeter;
  report(bug: BugReport): void;
}

/** One stage of the per-file pipeline. It changes files in `cwd`; the run decides whether to keep the change. */
export interface Step {
  readonly id: StepId;
  run(context: StepContext): Promise<void>;
  /** The only paths (relative to the target) the step may change for `file`; anything else fails the attempt. */
  allowedChanges?(file: string): string[];
  /** Test files the step writes for `file`; they count for coverage and can be protected from later steps. */
  producesTests?(file: string): string[];
  /** Checked once before the first file, e.g. that the model can be reached. */
  preflight?(): Promise<void>;
}

export type StepRegistry = Partial<Record<StepId, Step>>;
