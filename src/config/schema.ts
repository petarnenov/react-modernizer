import { z } from 'zod';

/** The steps a file goes through, in this order. Each can be switched off. */
export const STEP_IDS = [
  'analyze',
  'characterize-tests',
  'class-to-function',
  'redux-connect-to-hooks',
  'js-to-ts',
  'simplify',
] as const;

export type StepId = (typeof STEP_IDS)[number];

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

const DEFAULT_INCLUDE = ['src/**/*.{js,jsx}'];

/** A test belongs to the file it tests; it is not a unit of work of its own. */
export const DEFAULT_EXCLUDE = [
  '**/*.test.{js,jsx}',
  '**/*.spec.{js,jsx}',
  '**/__tests__/**',
  '**/setupTests.js',
];

const stepSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Model for this step; falls back to `model.default`. */
    model: z.string().min(1).optional(),
  })
  .loose();

const stepsSchema = z
  .object({
    analyze: stepSchema.default({ enabled: true }),
    'characterize-tests': stepSchema
      .extend({
        /** What the step's model runs to execute its tests; `{testFile}` is the characterization test file. */
        testCommand: z.string().min(1).default('npx jest --ci {testFile}'),
        /** Test helpers the model must use, e.g. `src/test-utils.js` with `renderWithProviders`. */
        helpers: z.array(z.string().min(1)).default([]),
      })
      .prefault({}),
    'class-to-function': stepSchema
      .extend({ skip: z.array(z.enum(['error-boundary'])).default(['error-boundary']) })
      .default({ enabled: true, skip: ['error-boundary'] }),
    // Changes how components are wired and tested — a separate decision, off unless asked for.
    'redux-connect-to-hooks': stepSchema.default({ enabled: false }),
    'js-to-ts': stepSchema
      .extend({ codemod: z.enum(['none', 'ts-migrate']).default('ts-migrate') })
      .default({ enabled: true, codemod: 'ts-migrate' }),
    simplify: stepSchema.default({ enabled: true }),
  })
  .strict();

export const configSchema = z
  .object({
    /** Root of the codebase being modernized. Relative paths resolve against the config file. */
    target: z.string().min(1),
    source: z
      .object({
        include: z.array(z.string().min(1)).min(1).default(DEFAULT_INCLUDE),
        /** Setting it replaces the default list; it does not add to it. */
        exclude: z.array(z.string().min(1)).default(DEFAULT_EXCLUDE),
      })
      .strict()
      .default({ include: DEFAULT_INCLUDE, exclude: DEFAULT_EXCLUDE }),
    /** `dependency-graph` processes leaves first so types flow upwards. */
    order: z.enum(['dependency-graph', 'alphabetical']).default('dependency-graph'),
    steps: stepsSchema.default(stepsSchema.parse({})),
    gates: z
      .object({
        commands: z
          .array(z.string().min(1))
          .min(1)
          .default([
            'npx eslint {files}',
            'npx tsc --noEmit --incremental',
            'npx jest --findRelatedTests {files}',
          ]),
        coverage: z
          .object({ min: z.number().min(0).max(100).default(80) })
          .strict()
          .default({ min: 80 }),
        /** Patterns the agent may not introduce; checked on the diff, not the whole file. */
        forbid: z
          .array(z.string().min(1))
          .default([
            ': any',
            'as any',
            '@ts-ignore',
            '@ts-nocheck',
            'eslint-disable',
            'toMatchSnapshot',
          ]),
        /** Tests written by this step may not be deleted or weakened by later steps. */
        protectTestsFrom: z.enum(STEP_IDS).nullable().default('characterize-tests'),
        /** How long one gate command may run before it is stopped and counted as failed. */
        timeoutSeconds: z.number().int().min(1).default(600),
      })
      .strict()
      // prefault runs `{}` through the schema, so the defaults above are the only ones.
      .prefault({}),
    git: z
      .object({
        /** Accepted files are committed here; the user's own branch is never touched. */
        branch: z.string().min(1).default('modernizer/run'),
        /** Where the run branch starts when it does not exist yet. */
        base: z.string().min(1).default('HEAD'),
      })
      .strict()
      .prefault({}),
    retry: z
      .object({
        perStep: z.number().int().min(0).max(10).default(3),
        onFail: z.enum(['revert-and-report', 'stop']).default('revert-and-report'),
      })
      .strict()
      .default({ perStep: 3, onFail: 'revert-and-report' }),
    concurrency: z
      .object({
        /** How many agents work at once. One by default: predictable, debuggable, right for a pilot. */
        workers: z.number().int().min(1).max(64).default(1),
        /** How many gate runs (lint/tsc/jest) at once; defaults to `workers`. */
        gates: z.number().int().min(1).max(64).optional(),
        /** Shared ceiling on model requests across all workers. */
        requestsPerMinute: z.number().int().min(1).default(50),
      })
      .strict()
      .default({ workers: 1, requestsPerMinute: 50 }),
    budget: z
      .object({
        maxTokensPerFile: z.number().int().positive().default(200_000),
        maxTotalCostUsd: z.number().positive().nullable().default(null),
      })
      .strict()
      .default({ maxTokensPerFile: 200_000, maxTotalCostUsd: null }),
    batching: z
      .object({
        by: z.enum(['directory', 'none']).default('directory'),
        maxFiles: z.number().int().min(1).default(40),
      })
      .strict()
      .default({ by: 'directory', maxFiles: 40 }),
    model: z
      .object({
        /** The model steps use unless a step sets its own. */
        default: z.string().min(1).default('claude-sonnet-5'),
        /** Reasoning effort; adaptive thinking decides how much of it to use. */
        effort: z.enum(EFFORTS).default('high'),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type ModernizerConfig = z.infer<typeof configSchema>;
