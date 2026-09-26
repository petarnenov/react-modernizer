import { ERROR_FORMATS, type ErrorFormat } from '../run/baseline.js';
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

export const MODEL_PROVIDERS = ['anthropic', 'ollama'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

const DEFAULT_MODEL: Record<ModelProvider, string> = {
  anthropic: 'claude-sonnet-5',
  ollama: 'gpt-oss:120b',
};

export const DEFAULT_OLLAMA_URL = 'https://ollama.com';

const DEFAULT_INCLUDE = ['src/**/*.{js,jsx}'];

/** Type-checks the whole project, keeping tsc's incremental state outside the worktree. */
const TYPECHECK = 'npx tsc --noEmit --incremental --tsBuildInfoFile {cache}/tsc.tsbuildinfo';

/** A gate command as written: a string, or a command whose errors are judged against a baseline. */
const gateCommandSchema = z
  .union([
    z.string().min(1),
    z.object({ run: z.string().min(1), newErrorsOnly: z.enum(ERROR_FORMATS).optional() }).strict(),
  ])
  .transform((c): GateCommand => (typeof c === 'string' ? { run: c } : c));

export interface GateCommand {
  run: string;
  /** Fail only on errors new against the baseline, parsed in this tool's format. */
  newErrorsOnly?: ErrorFormat | undefined;
}

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
    analyze: stepSchema
      .extend({
        /** Its output for the file is evidence for the model; `{file}` is the file. */
        lintCommand: z.string().min(1).default('npx eslint --format unix {file}'),
        /** Files with fewer code lines are not analysed; 0 analyses every file. */
        minLines: z.number().int().min(0).default(0),
      })
      .prefault({}),
    'characterize-tests': stepSchema
      .extend({
        /** What the step's model runs to execute its tests; `{testFile}` is the characterization test file. */
        testCommand: z.string().min(1).default('{testRunner} {testFile}'),
        /** Test helpers the model must use, e.g. `src/test-utils.js` with `renderWithProviders`. */
        helpers: z.array(z.string().min(1)).default([]),
      })
      .prefault({}),
    'class-to-function': stepSchema
      .extend({
        skip: z.array(z.enum(['error-boundary'])).default(['error-boundary']),
        /** What the step's model runs: the tests related to the file, characterization tests included. */
        testCommand: z.string().min(1).default('{testRunner} --findRelatedTests {file}'),
        /** Refuse to convert without characterization tests; turning this off is a deliberate choice. */
        requireTests: z.boolean().default(true),
      })
      .prefault({}),
    // Changes how components are wired and tested — a separate decision, off unless asked for.
    'redux-connect-to-hooks': stepSchema.default({ enabled: false }),
    'js-to-ts': stepSchema
      .extend({
        /** Type-checks the project; the step's model sees the errors in its two files. */
        typecheckCommand: z.string().min(1).default(TYPECHECK),
        /** What the step's model runs: the tests related to the file. */
        testCommand: z.string().min(1).default('{testRunner} --findRelatedTests {file}'),
        /** Files with shared types to use rather than re-declare, e.g. typed Redux hooks. */
        helpers: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .prefault({}),
    simplify: stepSchema
      .extend({
        /** Files with fewer code lines (comments and formatting ignored) are not worth a model call. */
        minLines: z.number().int().min(0).default(40),
        testCommand: z.string().min(1).default('{testRunner} --findRelatedTests {file}'),
        typecheckCommand: z.string().min(1).default(TYPECHECK),
      })
      .prefault({}),
  })
  .strict();

export const configSchema = z
  .object({
    /** Root of the codebase being modernized. Relative paths resolve against the config file. */
    target: z.string().min(1),
    /**
     * How the target runs its tests; `{testRunner}` in any command stands for it. Create React App runs Jest only
     * through react-scripts, which supplies the Babel, jsdom and CSS-module setup.
     */
    testRunner: z.string().min(1).default('CI=true npx react-scripts test --watchAll=false'),
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
        /**
         * Run in order after each step. A string passes when it exits zero; `{ run, newErrorsOnly }` passes when the
         * tool reports no error that is new against its baseline. `{files}`: the changed files; `{cache}`: a
         * directory outside the worktree, kept across runs.
         */
        commands: z
          .array(gateCommandSchema)
          .min(1)
          .default([
            { run: 'npx eslint --format json {files}', newErrorsOnly: 'eslint' },
            { run: TYPECHECK, newErrorsOnly: 'tsc' },
            { run: '{testRunner} --findRelatedTests {files}' },
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
            '@ts-expect-error',
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
        /** Who serves the model. */
        provider: z.enum(MODEL_PROVIDERS).default('anthropic'),
        /** The model steps use unless a step sets its own; defaults per provider. */
        default: z.string().min(1).optional(),
        /** Reasoning effort; adaptive thinking decides how much of it to use. */
        effort: z.enum(EFFORTS).default('high'),
        /** Ollama server; Ollama Cloud by default, or a local one such as `http://localhost:11434`. */
        baseUrl: z.url().optional(),
        /** Environment variable holding the Ollama API key. The key itself never goes in the file. */
        apiKeyEnv: z.string().min(1).default('OLLAMA_API_KEY'),
      })
      .strict()
      .prefault({})
      .transform(({ default: model, baseUrl, ...rest }) => ({
        ...rest,
        default: model ?? DEFAULT_MODEL[rest.provider],
        baseUrl: baseUrl ?? DEFAULT_OLLAMA_URL,
      })),
  })
  .strict();

export type ModernizerConfig = z.infer<typeof configSchema>;
