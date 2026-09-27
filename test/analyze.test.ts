import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { parseConfig } from '../src/config/load.js';
import type { ModelClient, ModelTool, ToolRunRequest, ModelInfo } from '../src/model/client.js';
import type { UsageMeter } from '../src/model/usage.js';
import { runModernizer } from '../src/run/runner.js';
import { loadState } from '../src/run/state.js';
import { SYSTEM_PROMPT } from '../src/steps/analyze/instructions.js';
import { lintEvidence } from '../src/steps/analyze/step.js';
import { createBuiltInSteps } from '../src/steps/registry.js';
import type { Step } from '../src/steps/step.js';
import { tempRepo, runStatePath } from './helpers/repo.js';

type Tools = Record<string, ModelTool<never>>;

class ScriptedModel implements ModelClient {
  readonly requests: ToolRunRequest[] = [];
  constructor(
    private readonly script: (tools: Tools, request: ToolRunRequest) => Promise<void> = () =>
      Promise.resolve(),
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
    await this.script(Object.fromEntries(request.tools.map((t) => [t.name, t])), request);
    return { text: 'done' };
  }
}

const report = (tools: Tools, input: unknown) => {
  const tool = tools.report_bug;
  if (tool === undefined) throw new Error('no report_bug');
  return tool.run(input as never);
};

const TIMER = [
  "import { useEffect, useState } from 'react';",
  'export function Timer() {',
  '  const [count, setCount] = useState(0);',
  '  useEffect(() => {',
  '    const id = setInterval(() => setCount(count + 1), 1000);',
  '  }, []);',
  '  return <span>{count}</span>;',
  '}',
  '',
].join('\n');

const ONLY_ANALYZE = {
  'characterize-tests': { enabled: false },
  'class-to-function': { enabled: false },
  'js-to-ts': { enabled: false },
  simplify: { enabled: false },
};

function config(root: string, analyze: Record<string, unknown> = {}, gates: string[] = ['true']) {
  return parseConfig({
    target: root,
    steps: { ...ONLY_ANALYZE, analyze: { lintCommand: 'true', ...analyze } },
    gates: { commands: gates, coverage: { min: 0 } },
  });
}

const stateOf = async (root: string) => loadState(runStatePath(root));

describe('configuration', () => {
  it('analyses every file by default with ESLint as evidence', () => {
    expect(parseConfig({ target: '.' }).steps.analyze).toMatchObject({
      lintCommand: 'npx eslint --format unix {file}',
      minLines: 0,
    });
  });

  it('can use a cheaper model for analysis only', () => {
    const cfg = parseConfig({ target: '.', steps: { analyze: { model: 'claude-haiku-4-5' } } });

    expect(cfg.steps.analyze.model).toBe('claude-haiku-4-5');
    expect(cfg.model.default).toBe('claude-sonnet-5');
  });
});

describe('lintEvidence', () => {
  const cwd = process.cwd();

  it('returns what the linter reports, even when it exits non-zero', async () => {
    expect(await lintEvidence('echo "a.js:1:1: problem"; exit 1', cwd, 'a.js', 30)).toBe(
      'a.js:1:1: problem\n',
    );
  });

  it('is undefined when the linter cannot run', async () => {
    expect(await lintEvidence('definitely-not-a-linter {file}', cwd, 'a.js', 30)).toBeUndefined();
  });
});

describe('instructions', () => {
  it('state every direction and restriction', () => {
    for (const rule of [
      'You cannot change anything',
      'logic errors',
      'stale closures',
      'missing cleanup',
      'race conditions',
      'after unmount',
      'mutation of props or state',
      'key props',
      'unhandled promise rejections',
      'accessibility',
      'class-component behaviour',
      'Report only what you can point to',
      'severity',
      'No style remarks',
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });
});

describe('findings', () => {
  it('carry the step that reported them and their severity, and status groups them', async () => {
    const root = await tempRepo({
      'src/Cart.jsx': 'export const Cart = 1;\n',
      'src/List.jsx': 'export const List = 1;\n',
    });
    const reporting = (
      id: 'analyze' | 'simplify',
      bug: (file: string) => object | undefined,
    ): Step => ({
      id,
      run: (ctx) => {
        const found = bug(ctx.file);
        if (found !== undefined) ctx.report(found as never);
        return Promise.resolve();
      },
    });
    const steps = {
      analyze: reporting('analyze', (f) =>
        f === 'src/Cart.jsx'
          ? { line: 31, severity: 'high', reason: 'total ignores discounts' }
          : { line: 12, severity: 'low', reason: 'index used as key' },
      ),
      simplify: reporting('simplify', (f) =>
        f === 'src/List.jsx' ? { reason: 'looks unused' } : undefined,
      ),
    };
    const yaml = join(root, '..', `${root.split('/').pop() ?? 'x'}-findings.yaml`);
    await writeFile(
      yaml,
      `target: ${JSON.stringify(root)}\nsteps:\n  characterize-tests: { enabled: false }\n  class-to-function: { enabled: false }\n  js-to-ts: { enabled: false }\ngates:\n  commands: ['true']\n`,
    );
    let out = '';
    const io = { stdout: (t: string) => (out += t), stderr: () => undefined };

    await main(['run', yaml, '--files', 'all'], io, steps);
    out = '';
    await main(['status', yaml], io);

    const state = await stateOf(root);
    expect(state?.files['src/Cart.jsx']?.bugs).toEqual([
      { line: 31, severity: 'high', reason: 'total ignores discounts', step: 'analyze' },
    ]);
    expect(out).toContain('reported bugs: 3 (high 1 · medium 0 · low 1 · unrated 1)');
    const listed = out.split('\n').filter((l) => l.startsWith('  ['));
    expect(listed).toEqual([
      '  [high] src/Cart.jsx:31  total ignores discounts  (analyze)',
      '  [low] src/List.jsx:12  index used as key  (analyze)',
      '  [unrated] src/List.jsx  looks unused  (simplify)',
    ]);
  });
});

describe('analyze in a run', () => {
  const run = (cfg: ReturnType<typeof parseConfig>, model: ModelClient) =>
    runModernizer({ config: cfg, steps: createBuiltInSteps(cfg, model), log: () => undefined });

  it('has read-only tools and leaves the file unchanged', async () => {
    const root = await tempRepo({ 'src/Timer.jsx': TIMER });
    const model = new ScriptedModel();

    expect((await run(config(root), model)).done).toBe(1);
    expect(model.requests[0]?.tools.map((t) => t.name).sort()).toEqual(['read_file', 'report_bug']);
  });

  it('reads the file and its tests, and is refused any other file', async () => {
    const PAGE = "import { Timer } from './Timer';\nexport const Page = () => <Timer />;\n";
    const root = await tempRepo({
      'src/Timer.jsx': TIMER,
      'src/Timer.test.js': 'test("ticks", () => {});\n',
      'src/Page.tsx': PAGE,
    });
    const reads: string[] = [];
    const model = new ScriptedModel(async (tools) => {
      const read = tools.read_file;
      if (read === undefined) throw new Error('no read_file');
      reads.push(await read.run({ path: 'src/Timer.jsx' } as never));
      reads.push(await read.run({ path: 'src/Timer.test.js' } as never));
      await expect(read.run({ path: 'src/Page.tsx' } as never)).rejects.toThrow(
        'only these files can be read',
      );
    });

    expect((await run(config(root), model)).done).toBe(1);
    expect(reads).toEqual([TIMER, 'test("ticks", () => {});\n']);
    expect(model.requests[0]?.prompt).toContain('src/Timer.test.js');
  });

  it('does not name the importers in the prompt', async () => {
    const root = await tempRepo({
      'src/Timer.jsx': TIMER,
      'src/Page.tsx': "import { Timer } from './Timer';\nexport const Page = () => <Timer />;\n",
    });
    const model = new ScriptedModel();

    await run(config(root), model);

    expect(model.requests[0]?.prompt).toContain('src/Timer.jsx');
    expect(model.requests[0]?.prompt).not.toContain('Page');
  });

  it('gives the model the linter output', async () => {
    const root = await tempRepo({ 'src/Timer.jsx': TIMER });
    const model = new ScriptedModel();
    const lint = `echo "src/Timer.jsx:6:6: React Hook useEffect has a missing dependency: 'count' [react-hooks/exhaustive-deps]"; exit 1`;

    await run(config(root, { lintCommand: lint }), model);

    expect(model.requests[0]?.prompt).toContain('[react-hooks/exhaustive-deps]');
  });

  it('says when no linter could run', async () => {
    const root = await tempRepo({ 'src/Timer.jsx': TIMER });
    const model = new ScriptedModel();

    await run(config(root, { lintCommand: 'definitely-not-a-linter {file}' }), model);

    expect(model.requests[0]?.prompt).toContain('Linter output: none available');
  });

  it('records a finding with line, severity and step', async () => {
    const root = await tempRepo({ 'src/Timer.jsx': TIMER });
    const model = new ScriptedModel(async (tools) => {
      await report(tools, {
        line: 5,
        severity: 'medium',
        reason: 'interval reads the count captured on mount',
      });
      await report(tools, { line: 5, severity: 'medium', reason: 'interval is never cleared' });
    });

    await run(config(root), model);

    expect((await stateOf(root))?.files['src/Timer.jsx']?.bugs).toEqual([
      {
        line: 5,
        severity: 'medium',
        reason: 'interval reads the count captured on mount',
        step: 'analyze',
      },
      { line: 5, severity: 'medium', reason: 'interval is never cleared', step: 'analyze' },
    ]);
  });

  it('passes a clean file with no findings', async () => {
    const root = await tempRepo({ 'src/Timer.jsx': TIMER });

    expect((await run(config(root), new ScriptedModel())).done).toBe(1);
    expect((await stateOf(root))?.files['src/Timer.jsx']?.bugs).toBeUndefined();
  });

  it('skips a small file without a model call', async () => {
    const root = await tempRepo({ 'src/Timer.jsx': TIMER });
    const model = new ScriptedModel();

    await run(config(root, { minLines: 30 }), model);

    expect(model.requests).toHaveLength(0);
  });

  it('is not failed by gates the unchanged file already fails', async () => {
    const root = await tempRepo({ 'src/Timer.jsx': TIMER });

    const summary = await run(
      config(root, {}, ['echo "legacy lint error"; exit 1']),
      new ScriptedModel(),
    );

    expect(summary).toMatchObject({ done: 1, failed: 0 });
  });
});
