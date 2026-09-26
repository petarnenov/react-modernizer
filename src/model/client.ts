import type { z } from 'zod';
import type { Effort } from '../config/schema.js';
import type { UsageMeter } from './usage.js';

/** A tool the model may call. Throwing from `run` returns the message to the model as a tool error. */
export interface ModelTool<Input = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  run(input: Input): Promise<string>;
}

/** What a model client reports while it works on one file. Names, paths, counts and times only — never content. */
export type ModelProgress =
  | { kind: 'model-turn'; turn: number }
  | { kind: 'tool-call'; tool: string; detail?: string }
  | { kind: 'rate-wait'; ms: number };

export type ModelProgressSink = (event: ModelProgress) => void;

export interface ToolRunRequest {
  model: string;
  effort: Effort;
  /** Stable instructions; cached across files. */
  system: string;
  /** The per-file task. */
  prompt: string;
  // Tools of different input types in one list.
  tools: ModelTool<never>[];
  /** Upper bound on model turns for one call. */
  maxIterations: number;
  /** Told about each request, tool call and rate-limit wait. */
  progress?: ModelProgressSink | undefined;
}

export interface ToolRunResult {
  /** The model's closing text. */
  text: string;
}

/** Access to the model for steps: the only way a step talks to it. */
export interface ModelClient {
  /** Fails with {@link ModelAccessError} when the model cannot be reached with the current credentials. */
  check(model: string): Promise<void>;
  /** Runs the model with tools until it stops calling them; usage goes to `meter`, which enforces the budget. */
  runTools(request: ToolRunRequest, meter: UsageMeter): Promise<ToolRunResult>;
}

export class ModelAccessError extends Error {
  override readonly name = 'ModelAccessError';
}

export class ModelRefusalError extends Error {
  override readonly name = 'ModelRefusalError';
}

/** Typed helper so a tool's `run` sees its schema's type while the list stays heterogeneous. */
export function defineTool<Input>(tool: ModelTool<Input>): ModelTool<never> {
  return tool as unknown as ModelTool<never>;
}
