import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.js';
import type { ModelClient, ModelTool, ToolRunRequest } from '../src/model/client.js';
import type { UsageMeter } from '../src/model/usage.js';
import { runModernizer } from '../src/run/runner.js';
import { loadState } from '../src/run/state.js';
import { SYSTEM_PROMPT } from '../src/steps/simplify/instructions.js';
import { measure, notSimpler } from '../src/steps/simplify/metrics.js';
import { createSimplifyStep } from '../src/steps/simplify/step.js';
import type { Step } from '../src/steps/step.js';
import { sh, tempRepo } from './helpers/repo.js';

type Tools = Record<string, ModelTool<never>>;

class ScriptedModel implements ModelClient {
  readonly requests: ToolRunRequest[] = [];
  constructor(private readonly script: (tools: Tools, request: ToolRunRequest) => Promise<void>) {}
  check(): Promise<void> {
    return Promise.resolve();
  }
  async runTools(request: ToolRunRequest, meter: UsageMeter) {
    this.requests.push(request);
    meter.add({ input_tokens: 10, output_tokens: 1 });
    await this.script(Object.fromEntries(request.tools.map((t) => [t.name, t])), request);
    return { text: 'done' };
  }
}

const write = (tools: Tools, content: string) => {
  const tool = tools.write_file;
  if (tool === undefined) throw new Error('no write_file');
  return tool.run({ content } as never);
};

describe('configuration', () => {
  it('defaults the simplify options', () => {
    expect(parseConfig({ target: '.' }).steps.simplify).toMatchObject({
      minLines: 40,
      testCommand: '{testRunner} --findRelatedTests {file}',
      typecheckCommand: 'npx tsc --noEmit --incremental',
    });
    expect(
      parseConfig({ target: '.', steps: { simplify: { minLines: 0 } } }).steps.simplify.minLines,
    ).toBe(0);
  });
});

describe('measure and notSimpler', () => {
  it('ignores formatting and comments', () => {
    const tight = 'export const f = (a) => { if (a) { return 1; } return 2; };';
    const loose =
      '// comment\nexport const f = (a) => {\n\n  if (a) {\n    return 1; // one\n  }\n  return 2;\n};\n';

    expect(measure('a.js', loose)).toEqual(measure('a.js', tight));
  });

  it('ignores how arrays, calls and trailing commas are laid out', () => {
    const tight = 'export const x = f([1, 2, 3], { a: 1, b: [4] });';
    const loose =
      'export const x = f(\n  [\n    1,\n    2,\n    3,\n  ],\n  {\n    a: 1,\n    b: [4,],\n  },\n);\n';

    expect(measure('a.js', loose)).toEqual(measure('a.js', tight));
  });

  it.each([
    ['if (plus its block)', 'if (a) {}', 2],
    ['?:', 'x = a ? 1 : 2;', 1],
    ['case', 'switch (a) { case 1: break; case 2: break; default: }', 2],
    [
      'loops (plus a block)',
      'for (;;) {} for (const x of y) {} for (const k in y) {} while (a) {} do {} while (a);',
      6,
    ],
    ['catch (plus a block)', 'try {} catch {}', 2],
    ['&& || ??', 'x = (a && b) || (c ?? d);', 3],
    ['nothing', 'x = 1;', 0],
  ])('counts %s', (_, code, complexity) => {
    expect(measure('a.js', code).complexity).toBe(complexity);
  });

  it('counts nesting', () => {
    expect(measure('a.js', 'function f() { if (a) { if (b) { g(); } } }').complexity).toBe(2 + 3);
  });

  it('accepts only simpler, and says why not', () => {
    expect(
      notSimpler({ lines: 120, complexity: 18 }, { lines: 96, complexity: 15 }),
    ).toBeUndefined();
    expect(
      notSimpler({ lines: 120, complexity: 18 }, { lines: 120, complexity: 17 }),
    ).toBeUndefined();
    expect(notSimpler({ lines: 120, complexity: 18 }, { lines: 140, complexity: 12 })).toContain(
      '120 → 140 code lines',
    );
    expect(notSimpler({ lines: 120, complexity: 18 }, { lines: 120, complexity: 18 })).toContain(
      'not simpler',
    );
  });
});

describe('instructions', () => {
  it('state every direction and prohibition', () => {
    for (const rule of [
      'identical behaviour',
      'compute them during render',
      'you might not need an effect',
      'early returns',
      'one mapped list',
      'unused variables, imports and private helpers',
      'never exports',
      'remove useMemo, useCallback or memo',
      'add dependencies, change libraries',
      'Redux, React Query, Zustand',
      'rename, remove or add exports',
      'report_bug',
      'leave the file unchanged',
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });
});

describe('simplify in a run', () => {
  /** A long function with dead locals: easy to shorten without touching behaviour. */
  const LONG = [
    'export type TotalOptions = { round: boolean };',
    'export function total(items: number[], options: TotalOptions): number {',
    '  let sum = 0;',
    ...Array.from({ length: 40 }, (_, i) => `  const unused${String(i)} = ${String(i)};`),
    '  for (const item of items) {',
    '    sum = sum + item;',
    '  }',
    '  return options.round ? Math.round(sum) : sum;',
    '}',
    '',
  ].join('\n');
  const SHORT = [
    'export type TotalOptions = { round: boolean };',
    'export function total(items: number[], options: TotalOptions): number {',
    '  const sum = items.reduce((acc, item) => acc + item, 0);',
    '  return options.round ? Math.round(sum) : sum;',
    '}',
    '',
  ].join('\n');

  async function setup(files: Record<string, string>) {
    const root = await tempRepo(files);
    const config = parseConfig({
      target: root,
      source: { include: ['src/**/*.ts'], exclude: ['**/*.test.ts'] },
      steps: {
        analyze: { enabled: false },
        'characterize-tests': { enabled: false },
        'class-to-function': { enabled: false },
        'js-to-ts': { enabled: false },
        simplify: { testCommand: 'true', typecheckCommand: 'true' },
      },
      gates: { commands: ['true'], coverage: { min: 0 } },
      retry: { perStep: 1 },
    });
    return { root, config };
  }
  const run = (config: ReturnType<typeof parseConfig>, step: Step) =>
    runModernizer({ config, steps: { simplify: step }, log: () => undefined });
  const reason = async (root: string, file: string) =>
    (await loadState(join(root, '.git/modernizer/runs/modernizer__run/state.json')))?.files[file]
      ?.reason;

  it('skips a small file without a model call', async () => {
    const { config } = await setup({ 'src/small.ts': SHORT });
    const model = new ScriptedModel(() => Promise.reject(new Error('must not be called')));

    expect((await run(config, createSimplifyStep(config, model))).done).toBe(1);
    expect(model.requests).toHaveLength(0);
  });

  it('simplifies a large file and commits it', async () => {
    const { root, config } = await setup({ 'src/total.ts': LONG });
    const model = new ScriptedModel(async (tools, request) => {
      expect(request.prompt).toMatch(/Now: \d+ code lines, complexity \d+/);
      await write(tools, SHORT);
    });

    expect((await run(config, createSimplifyStep(config, model))).done).toBe(1);
    expect(sh(root, 'show', 'modernizer/run:src/total.ts')).toBe(SHORT.trim());
  });

  it('puts back an edited test and fails', async () => {
    const { root, config } = await setup({
      'src/total.ts': LONG,
      'src/total.test.ts': "test('t', () => {});\n",
    });
    const real = createSimplifyStep(
      config,
      new ScriptedModel((tools) => write(tools, SHORT).then(() => undefined)),
    );
    const step: Step = {
      ...real,
      run: async (ctx) => {
        await real.run(ctx);
        await writeFile(join(ctx.cwd, 'src/total.test.ts'), 'weaker\n');
      },
    };

    expect((await run(config, step)).failed).toBe(1);
    expect(await reason(root, 'src/total.ts')).toContain('(put back): src/total.test.ts');
  });

  it('fails when an export is removed', async () => {
    const { root, config } = await setup({ 'src/total.ts': LONG });
    const model = new ScriptedModel((tools) =>
      write(tools, SHORT.replace('export type TotalOptions', 'type TotalOptions')).then(
        () => undefined,
      ),
    );

    expect((await run(config, createSimplifyStep(config, model))).failed).toBe(1);
    expect(await reason(root, 'src/total.ts')).toContain('missing: TotalOptions');
  });

  it('rejects a longer file and accepts the retry', async () => {
    const { config } = await setup({ 'src/total.ts': LONG });
    const longer = LONG.replace(
      '  let sum = 0;',
      '  let sum = 0;\n  const more = 1;\n  const evenMore = 2;',
    );
    const model = new ScriptedModel((tools, request) =>
      write(tools, request.prompt.includes('not simpler') ? SHORT : longer).then(() => undefined),
    );

    expect((await run(config, createSimplifyStep(config, model))).done).toBe(1);
    expect(model.requests[1]?.prompt).toContain('not simpler');
  });

  it('passes a file left unchanged, and drops formatting-only edits', async () => {
    const { root, config } = await setup({ 'src/total.ts': LONG });
    const model = new ScriptedModel((tools) =>
      write(tools, `// reformatted\n${LONG.replaceAll('  ', '    ')}`).then(() => undefined),
    );

    expect((await run(config, createSimplifyStep(config, model))).done).toBe(1);
    expect(sh(root, 'rev-list', '--count', 'main..modernizer/run')).toBe('0');
  });
});
