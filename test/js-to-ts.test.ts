import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config/load.js';
import type { ModelClient, ModelTool, ToolRunRequest, ModelInfo } from '../src/model/client.js';
import type { UsageMeter } from '../src/model/usage.js';
import { runModernizer } from '../src/run/runner.js';
import { loadState } from '../src/run/state.js';
import { exports } from '../src/steps/class-to-function/analysis.js';
import { typesOnlyDifference } from '../src/steps/js-to-ts/erase.js';
import { SYSTEM_PROMPT } from '../src/steps/js-to-ts/instructions.js';
import {
  breakingImporters,
  containsJsx,
  errorsFor,
  typedPath,
} from '../src/steps/js-to-ts/step.js';
import { createBuiltInSteps } from '../src/steps/registry.js';
import type { Importer, Step } from '../src/steps/step.js';
import { sh, tempRepo } from './helpers/repo.js';

type Tools = Record<string, ModelTool<never>>;

class ScriptedModel implements ModelClient {
  readonly requests: ToolRunRequest[] = [];
  constructor(private readonly script: (tools: Tools, request: ToolRunRequest) => Promise<void>) {}
  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([]);
  }
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

const call = (tools: Tools, name: string, input: unknown): Promise<string> => {
  const tool = tools[name];
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool.run(input as never);
};

describe('configuration', () => {
  it('defaults the js-to-ts options and forbids @ts-expect-error', () => {
    const config = parseConfig({ target: '.' });

    expect(config.steps['js-to-ts']).toMatchObject({
      typecheckCommand: 'npx tsc --noEmit --incremental --tsBuildInfoFile {cache}/tsc.tsbuildinfo',
      testCommand: '{testRunner} {testFile}',
      helpers: [],
    });
    expect(config.gates.forbid).toContain('@ts-expect-error');
  });

  it('rejects the old codemod option', () => {
    expect(() =>
      parseConfig({ target: '.', steps: { 'js-to-ts': { codemod: 'ts-migrate' } } }),
    ).toThrow(/codemod/);
  });

  it('refuses to start without a tsconfig.json, processing no file', async () => {
    const root = await tempRepo({ 'src/a.js': 'export const a = 1;\n' });
    const calls: string[] = [];
    const step: Step = { id: 'js-to-ts', run: (ctx) => Promise.resolve(void calls.push(ctx.file)) };
    const config = parseConfig({
      target: root,
      steps: {
        analyze: { enabled: false },
        'characterize-tests': { enabled: false },
        'class-to-function': { enabled: false },
        simplify: { enabled: false },
      },
    });

    await expect(
      runModernizer({ config, steps: { 'js-to-ts': step }, log: () => undefined }),
    ).rejects.toThrow(ConfigError);
    expect(calls).toEqual([]);
  });
});

describe('analysis', () => {
  it('tells value exports from type exports', () => {
    const found = exports(
      'a.ts',
      [
        'export interface CardProps { title: string }',
        'export type Size = "s" | "m";',
        "export type { Theme } from './theme';",
        "export { type Other, value } from './other';",
        'export default function Card() {}',
      ].join('\n'),
    );

    expect(found).toEqual([
      { name: 'CardProps', kind: 'type' },
      { name: 'Other', kind: 'type' },
      { name: 'Size', kind: 'type' },
      { name: 'Theme', kind: 'type' },
      { name: 'default', kind: 'value' },
      { name: 'value', kind: 'value' },
    ]);
  });

  it('finds JSX, picks the TypeScript name, and spots breaking importers', () => {
    expect(containsJsx('a.js', 'export const A = () => <div />;')).toBe(true);
    expect(containsJsx('a.js', 'export const a = 1;')).toBe(false);
    expect(typedPath('src/Card.jsx', true)).toBe('src/Card.tsx');
    expect(typedPath('src/format.js', false)).toBe('src/format.ts');
    const importers: Importer[] = [
      { file: 'src/Page.jsx', specifier: './Card.jsx' },
      { file: 'src/List.jsx', specifier: './Card' },
    ];
    expect(breakingImporters(importers)).toEqual([importers[0]]);
  });

  it('keeps only type errors about the given files', () => {
    const output = [
      "src/Card.tsx(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      '  The expected type comes from property "count".',
      "src/Other.tsx(1,1): error TS2304: Cannot find name 'x'.",
    ].join('\n');

    expect(errorsFor(output, ['src/Card.tsx'])).toBe(
      "src/Card.tsx(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n  The expected type comes from property \"count\".",
    );
  });
});

describe('typesOnlyDifference', () => {
  const JS = [
    "import React, { useState } from 'react';",
    '// a comment',
    'export default function Card({ title, onPick }) {',
    '  const [open, setOpen] = useState(false);',
    '  const ref = React.useRef(null);',
    '  return <button ref={ref} onClick={() => onPick(title)}>{open ? title : "-"}</button>;',
    '}',
  ].join('\n');
  const TS = [
    "import React, { useState } from 'react';",
    "import type { Theme } from './theme';",
    'export interface CardProps { title: string; onPick: (title: string) => void; theme?: Theme }',
    'export default function Card({ title, onPick }: CardProps): React.JSX.Element {',
    '  const [open, setOpen] = useState<boolean>(false);',
    '  const ref = React.useRef<HTMLButtonElement>(null);',
    '  return <button ref={ref} onClick={() => onPick(title as string)}>{open ? title : "-"}</button>;',
    '}',
  ].join('\n');
  const compare = (typed: string) =>
    typesOnlyDifference({ fileName: 'Card.jsx', text: JS }, { fileName: 'Card.tsx', text: typed });

  it('accepts annotations, interfaces, generics, as, import type — and keeps React', () => {
    expect(compare(TS)).toBeUndefined();
  });

  it('ignores how blocks and objects are laid out', () => {
    const js = 'export const f = (a) => { if (a) { return { x: 1, y: 2 }; } return null; };';
    const ts =
      'export const f = (a: boolean) => {\n  if (a) {\n    return {\n      x: 1,\n      y: 2,\n    };\n  }\n  return null;\n};\n';

    expect(
      typesOnlyDifference({ fileName: 'f.js', text: js }, { fileName: 'f.ts', text: ts }),
    ).toBeUndefined();
  });

  it('rejects a guard added for the compiler, showing it', () => {
    const difference = compare(
      TS.replace('  const [open', '  if (!title) return null;\n  const [open'),
    );

    expect(difference).toContain('the code itself changed');
    expect(difference).toContain('if (!title)');
  });

  it('rejects an enum', () => {
    expect(compare(`${TS}\nexport enum Size { S, M }`)).toContain('the code itself changed');
  });
});

describe('instructions', () => {
  it('state every typing rule', () => {
    for (const rule of [
      'types only',
      'CardProps',
      'Never use any',
      'unknown',
      '@ts-ignore, @ts-expect-error or @ts-nocheck',
      'non-null assertions',
      'React.ChangeEvent',
      'useState<T>',
      'useRef<HTMLDivElement>(null)',
      'import type',
      'instead of enum',
      'useAppSelector',
      'report_bug',
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });
});

describe('importers reach the steps', () => {
  it('gives each file the files that import it and how', async () => {
    const root = await tempRepo({
      'src/Card.jsx': 'export const Card = () => null;\n',
      'src/Page.jsx': "import { Card } from './Card';\nexport const Page = () => Card;\n",
    });
    const seen: Record<string, readonly Importer[]> = {};
    const step: Step = {
      id: 'simplify',
      run: (ctx) => {
        seen[ctx.file] = ctx.importers;
        return Promise.resolve();
      },
    };
    const config = parseConfig({
      target: root,
      steps: {
        analyze: { enabled: false },
        'characterize-tests': { enabled: false },
        'class-to-function': { enabled: false },
        'js-to-ts': { enabled: false },
      },
      gates: { commands: ['true'] },
    });

    await runModernizer({ config, steps: { simplify: step }, log: () => undefined });

    expect(seen['src/Card.jsx']).toEqual([{ file: 'src/Page.jsx', specifier: './Card' }]);
    expect(seen['src/Page.jsx']).toEqual([]);
  });
});

describe('js-to-ts in a run', () => {
  const CARD =
    "import React from 'react';\nexport default function Card({ title }) {\n  return <p>{title}</p>;\n}\n";
  const CARD_TS =
    "import React from 'react';\nexport interface CardProps { title: string }\nexport default function Card({ title }: CardProps): React.JSX.Element {\n  return <p>{title}</p>;\n}\n";
  const TESTS =
    "import Card from './Card';\ntest('renders', () => { render(<Card title=\"x\" />); expect(Card).toBeDefined(); });\n";

  async function setup(files: Record<string, string>) {
    const root = await tempRepo({
      ...files,
      'tsconfig.json': '{ "compilerOptions": { "allowJs": true, "strict": true } }\n',
    });
    const errors = join(await mkdtemp(join(tmpdir(), 'modernizer-tsc-')), 'errors');
    await writeFile(errors, '');
    const config = parseConfig({
      target: root,
      steps: {
        analyze: { enabled: false },
        'characterize-tests': { enabled: false },
        'class-to-function': { enabled: false },
        simplify: { enabled: false },
        'js-to-ts': {
          typecheckCommand: `cat '${errors}'; test ! -s '${errors}'`,
          testCommand: 'true',
        },
      },
      gates: { commands: ['true'], coverage: { min: 0 } },
      retry: { perStep: 1 },
    });
    return { root, config, errors };
  }

  const run = async (config: ReturnType<typeof parseConfig>, model: ModelClient) =>
    runModernizer({ config, steps: createBuiltInSteps(config, model), log: () => undefined });

  it('renames a component and its tests to .tsx and commits them typed', async () => {
    const { root, config } = await setup({
      'src/Card.jsx': CARD,
      'src/Card.characterization.test.jsx': TESTS,
    });
    const model = new ScriptedModel(async (tools, request) => {
      expect(request.prompt).toContain('File to type: src/Card.tsx (was src/Card.jsx)');
      expect(request.prompt).toContain('src/Card.characterization.test.tsx');
      await call(tools, 'write_file', { content: CARD_TS });
      await call(tools, 'write_test_file', {
        content: TESTS.replace("test('renders'", "test('renders' as string"),
      });
      expect(await call(tools, 'check_types', {})).toBe('no type errors in your files');
    });

    const summary = await run(config, model);

    expect(summary.done).toBe(1);
    expect(sh(root, 'ls-tree', '-r', '--name-only', 'modernizer/run', 'src')).toBe(
      'src/Card.characterization.test.tsx\nsrc/Card.tsx',
    );
    expect(sh(root, 'show', 'modernizer/run:src/Card.tsx')).toContain('CardProps');
  });

  it('passes a file that is already TypeScript with no model call', async () => {
    const { config: base } = await setup({
      'src/done.ts': 'export const done = (): number => 1;\n',
    });
    const config = { ...base, source: { include: ['src/**/*.ts'], exclude: [] } };
    const model = new ScriptedModel(() => Promise.reject(new Error('must not be called')));

    expect((await run(config, model)).done).toBe(1);
    expect(model.requests).toHaveLength(0);
  });

  it('renames a module without JSX to .ts', async () => {
    const { root, config } = await setup({
      'src/format.js': 'export const format = (v) => String(v);\n',
    });
    const model = new ScriptedModel(async (tools) => {
      await call(tools, 'write_file', {
        content: 'export const format = (v: unknown): string => String(v);\n',
      });
    });

    expect((await run(config, model)).done).toBe(1);
    expect(sh(root, 'show', 'modernizer/run:src/format.ts')).toContain('(v: unknown): string');
  });

  it('fails a file whose importer names its extension, without a model call', async () => {
    const { root, config } = await setup({
      'src/Card.jsx': CARD,
      'src/Page.jsx': "import Card from './Card.jsx';\nexport const Page = () => Card;\n",
    });
    const model = new ScriptedModel(async (tools, request) => {
      await call(tools, 'write_file', {
        content: request.prompt.includes('Page')
          ? "import Card from './Card.jsx';\nexport const Page = (): unknown => Card;\n"
          : CARD_TS,
      });
    });

    await run(config, model);
    const state = await loadState(join(root, '.git/modernizer/runs/modernizer__run/state.json'));

    expect(state?.files['src/Card.jsx']?.reason).toContain("src/Page.jsx imports './Card.jsx'");
    expect(model.requests.filter((r) => r.prompt.includes('src/Card'))).toHaveLength(0);
  });

  it('fails while type errors remain, and gives the retry the errors', async () => {
    const { root, config, errors } = await setup({ 'src/Card.jsx': CARD });
    await writeFile(
      errors,
      "src/Card.tsx(3,10): error TS7031: Binding element 'title' implicitly has an 'any' type.\n",
    );
    const model = new ScriptedModel(async (tools) => {
      await call(tools, 'write_file', { content: CARD });
    });

    const summary = await run(config, model);
    const state = await loadState(join(root, '.git/modernizer/runs/modernizer__run/state.json'));

    expect(summary.failed).toBe(1);
    expect(model.requests[1]?.prompt).toContain('TS7031');
    expect(state?.files['src/Card.jsx']?.reason).toContain('type errors remain');
  });

  it('retries after a code change and passes with types only', async () => {
    const { config } = await setup({ 'src/Card.jsx': CARD });
    const model = new ScriptedModel(async (tools, request) => {
      const retry = request.prompt.includes('the code itself changed');
      await call(tools, 'write_file', {
        content: retry
          ? CARD_TS
          : CARD_TS.replace('  return <p>', '  if (!title) return null;\n  return <p>'),
      });
    });

    expect((await run(config, model)).done).toBe(1);
    expect(model.requests).toHaveLength(2);
  });
});
