import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config/load.js';
import type { ModelClient, ModelTool, ToolRunRequest, ModelInfo } from '../src/model/client.js';
import type { UsageMeter } from '../src/model/usage.js';
import { runModernizer } from '../src/run/runner.js';
import {
  exportedNames,
  exportsChanged,
  findClassComponents,
} from '../src/steps/class-to-function/analysis.js';
import { buildPrompt, SYSTEM_PROMPT } from '../src/steps/class-to-function/instructions.js';
import { createBuiltInSteps } from '../src/steps/registry.js';
import type { Step } from '../src/steps/step.js';
import { sh, tempRepo } from './helpers/repo.js';

type Tools = Record<string, ModelTool<never>>;

/** Scripted model per step: the script sees the request (to tell the steps apart) and calls tools directly. */
class ScriptedModel implements ModelClient {
  readonly requests: ToolRunRequest[] = [];
  constructor(
    private readonly script: (tools: Tools, request: ToolRunRequest, cwd: string) => Promise<void>,
  ) {}
  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([]);
  }
  check(): Promise<void> {
    return Promise.resolve();
  }
  async runTools(request: ToolRunRequest, meter: UsageMeter) {
    this.requests.push(request);
    meter.add({ input_tokens: 10, output_tokens: 1 });
    await this.script(Object.fromEntries(request.tools.map((t) => [t.name, t])), request, '');
    return { text: 'done' };
  }
}

const call = (tools: Tools, name: string, input: unknown): Promise<string> => {
  const tool = tools[name];
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool.run(input as never);
};

describe('findClassComponents', () => {
  it('finds every React base and names anonymous classes', () => {
    const found = findClassComponents(
      'a.jsx',
      [
        "import React, { Component, PureComponent } from 'react';",
        'class A extends Component { render() { return null; } }',
        'class B extends PureComponent {}',
        'export default class C extends React.Component {}',
        'const D = class extends React.PureComponent {};',
        'class NotReact extends Map {}',
      ].join('\n'),
    );

    expect(found.map((c) => [c.name, c.kind, c.line])).toEqual([
      ['A', 'component', 2],
      ['B', 'component', 3],
      ['C', 'component', 4],
      ['(anonymous)', 'component', 5],
    ]);
  });

  it.each([
    [
      'componentDidCatch',
      'class E extends Component { componentDidCatch() {} render() { return null; } }',
    ],
    [
      'getDerivedStateFromError',
      'class E extends Component { static getDerivedStateFromError() { return {}; } }',
    ],
  ])('recognises an error boundary by %s', (_, code) => {
    expect(findClassComponents('a.jsx', code)[0]?.kind).toBe('error-boundary');
  });
});

describe('exportedNames and exportsChanged', () => {
  it('lists default, named, renamed and re-exported names', () => {
    const names = exportedNames(
      'a.js',
      [
        'export default function Card() {}',
        'export const a = 1, b = 2;',
        'export function helper() {}',
        'const x = 1; export { x as renamed };',
        "export { thing } from './thing';",
        "export * from './all';",
        "export * as ns from './ns';",
      ].join('\n'),
    );

    expect(names).toEqual([
      "* from './all'",
      'a',
      'b',
      'default',
      'helper',
      'ns',
      'renamed',
      'thing',
    ]);
  });

  it('names what went missing and what was added', () => {
    expect(exportsChanged(['CardProps', 'default'], ['Props', 'default'])).toContain(
      'missing: CardProps; added: Props',
    );
    expect(exportsChanged(['a', 'default'], ['default', 'a'])).toBeUndefined();
  });
});

describe('instructions', () => {
  it('state every conversion rule', () => {
    for (const rule of [
      'same props and default props',
      'same side effects in the same order',
      'same public exports',
      'useEffect',
      'cleanup',
      'setState semantics',
      'useRef',
      'React.memo',
      'getDerivedStateFromProps',
      'forwardRef and useImperativeHandle',
      'connect()',
      'Keep the file JavaScript',
      'report_bug',
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  it('name the classes to convert and the skipped ones', () => {
    const prompt = buildPrompt({
      file: 'src/Card.jsx',
      convert: [{ name: 'Card', kind: 'component', line: 3 }],
      skipped: [{ name: 'Boundary', kind: 'error-boundary', line: 20 }],
    });

    expect(prompt).toContain('Class components to convert: Card (line 3)');
    expect(prompt).toContain('Leave these as classes (error boundaries): Boundary (line 20)');
  });
});

describe('class-to-function in a run', () => {
  const CLASS = [
    "import React from 'react';",
    'export default class Card extends React.Component {',
    '  render() { return <p>{this.props.title}</p>; }',
    '}',
    '',
  ].join('\n');
  const FUNCTION = [
    "import React from 'react';",
    'export default function Card({ title }) {',
    '  return <p>{title}</p>;',
    '}',
    '',
  ].join('\n');
  const TESTS =
    "import Card from './Card';\ntest('renders', () => { expect(Card).toBeDefined(); });\n";

  function config(root: string, overrides: Record<string, unknown> = {}) {
    return parseConfig({
      target: root,
      steps: {
        analyze: { enabled: false },
        'js-to-ts': { enabled: false },
        simplify: { enabled: false },
        'characterize-tests': { testCommand: 'true' },
        'class-to-function': { testCommand: 'true' },
      },
      gates: { commands: ['true'], coverage: { min: 0 } },
      retry: { perStep: 1 },
      ...overrides,
    });
  }

  /** Characterizes by writing TESTS, converts by writing `convert(attempt)` — or does something else. */
  function model(convert: (tools: Tools, request: ToolRunRequest) => Promise<void>) {
    return new ScriptedModel(async (tools, request) => {
      if (request.system.includes('characterization tests for one file')) {
        await call(tools, 'write_test_file', { content: TESTS });
      } else {
        await convert(tools, request);
      }
    });
  }

  const conversions = (m: ScriptedModel) =>
    m.requests.filter((r) => r.system.includes('convert React class'));

  it('makes no model call for a file with no class component', async () => {
    const root = await tempRepo({ 'src/Card.jsx': FUNCTION });
    const m = model(() => Promise.reject(new Error('must not be called')));
    const cfg = config(root);

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, m),
      log: () => undefined,
    });

    expect(summary.done).toBe(1);
    expect(conversions(m)).toHaveLength(0);
  });

  it('leaves an error boundary alone, with no model call', async () => {
    const boundary =
      "import { Component } from 'react';\nexport default class Boundary extends Component {\n  componentDidCatch() {}\n  render() { return this.props.children; }\n}\n";
    const root = await tempRepo({ 'src/Boundary.jsx': boundary });
    const m = model(() => Promise.reject(new Error('must not be called')));
    const cfg = config(root);

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, m),
      log: () => undefined,
    });

    expect(summary.done).toBe(1);
    expect(conversions(m)).toHaveLength(0);
    expect(sh(root, 'show', 'modernizer/run:src/Boundary.jsx')).toContain('extends Component');
  });

  it('converts a class component and commits the function component with the tests', async () => {
    const root = await tempRepo({ 'src/Card.jsx': CLASS });
    const m = model(async (tools) => {
      await call(tools, 'read_file', { path: 'src/Card.jsx' });
      await call(tools, 'write_file', { content: FUNCTION });
      expect(await call(tools, 'run_tests', {})).toMatch(/^PASSED/);
    });
    const cfg = config(root);

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, m),
      log: () => undefined,
    });

    expect(summary.done).toBe(1);
    expect(sh(root, 'show', 'modernizer/run:src/Card.jsx')).toBe(FUNCTION.trim());
    expect(sh(root, 'show', 'modernizer/run:src/Card.characterization.test.jsx')).toBe(
      TESTS.trim(),
    );
    expect(conversions(m)[0]?.prompt).toContain('Class components to convert: Card (line 2)');
  });

  it('puts back an edited test and fails the attempt', async () => {
    const root = await tempRepo({ 'src/Card.jsx': CLASS });
    const edits: Step = {
      id: 'class-to-function',
      allowedChanges: (f) => [f],
      async run(ctx) {
        await writeFile(join(ctx.cwd, 'src/Card.jsx'), FUNCTION);
        await writeFile(
          join(ctx.cwd, 'src/Card.characterization.test.jsx'),
          'test("weaker", () => {});\n',
        );
      },
    };
    const cfg = config(root);
    const steps = {
      ...createBuiltInSteps(
        cfg,
        model(() => Promise.resolve()),
      ),
      'class-to-function': edits,
    };

    const summary = await runModernizer({ config: cfg, steps, log: () => undefined });
    const state = JSON.parse(
      await readFile(join(root, '.git/modernizer/runs/modernizer__run/state.json'), 'utf8'),
    ) as { files: Record<string, { reason?: string }> };

    expect(summary.failed).toBe(1);
    expect(state.files['src/Card.jsx']?.reason).toContain(
      'changed files it may not change (put back): src/Card.characterization.test.jsx',
    );
  });

  it('rejects a class left behind and gives the retry the reason', async () => {
    const two = `${CLASS}export class Header extends React.Component { render() { return null; } }\n`;
    const root = await tempRepo({ 'src/Card.jsx': two });
    const m = model(async (tools, request) => {
      const retry = request.prompt.includes('class components remain');
      await call(tools, 'write_file', {
        content: retry
          ? `${FUNCTION}export function Header() { return null; }\n`
          : `${FUNCTION}export class Header extends React.Component { render() { return null; } }\n`,
      });
    });
    const cfg = config(root);

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, m),
      log: () => undefined,
    });

    expect(summary.done).toBe(1);
    expect(conversions(m)[1]?.prompt).toContain('class components remain: Header (line 5)');
  });

  it('rejects changed exports', async () => {
    const root = await tempRepo({ 'src/Card.jsx': `${CLASS}export const CardProps = {};\n` });
    const m = model((tools) =>
      call(tools, 'write_file', { content: `${FUNCTION}export const Props = {};\n` }).then(
        () => undefined,
      ),
    );
    const cfg = config(root, { retry: { perStep: 0 } });

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, m),
      log: () => undefined,
    });
    const state = JSON.parse(
      await readFile(join(root, '.git/modernizer/runs/modernizer__run/state.json'), 'utf8'),
    ) as { files: Record<string, { reason?: string }> };

    expect(summary.failed).toBe(1);
    expect(state.files['src/Card.jsx']?.reason).toContain('missing: CardProps; added: Props');
  });

  it('refuses to convert without characterization tests unless told otherwise', async () => {
    const root = await tempRepo({ 'src/Card.jsx': CLASS });
    const withoutTests = config(root, {
      steps: {
        analyze: { enabled: false },
        'js-to-ts': { enabled: false },
        simplify: { enabled: false },
        'characterize-tests': { enabled: false },
      },
    });

    await expect(
      runModernizer({ config: withoutTests, steps: {}, log: () => undefined }),
    ).rejects.toThrow(ConfigError);
    await expect(
      runModernizer({ config: withoutTests, steps: {}, log: () => undefined }),
    ).rejects.toThrow('steps.class-to-function.requireTests: false');

    const optedOut = config(root, {
      steps: {
        analyze: { enabled: false },
        'js-to-ts': { enabled: false },
        simplify: { enabled: false },
        'characterize-tests': { enabled: false },
        'class-to-function': { requireTests: false, testCommand: 'true' },
      },
    });
    const m = model((tools) =>
      call(tools, 'write_file', { content: FUNCTION }).then(() => undefined),
    );

    const summary = await runModernizer({
      config: optedOut,
      steps: createBuiltInSteps(optedOut, m),
      log: () => undefined,
    });
    expect(summary.done).toBe(1);
  });
});
