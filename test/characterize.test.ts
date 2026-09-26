import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { parseConfig } from '../src/config/load.js';
import {
  ModelAccessError,
  type ModelClient,
  type ModelTool,
  type ToolRunRequest,
  type ModelInfo,
} from '../src/model/client.js';
import type { UsageMeter } from '../src/model/usage.js';
import { runModernizer } from '../src/run/runner.js';
import { buildPrompt, SYSTEM_PROMPT } from '../src/steps/characterize-tests/instructions.js';
import { characterizationTestPath } from '../src/steps/characterize-tests/paths.js';
import { confine, createTools } from '../src/steps/characterize-tests/tools.js';
import { createBuiltInSteps } from '../src/steps/registry.js';
import { sh, tempRepo } from './helpers/repo.js';

type Tools = Record<string, ModelTool<never>>;
type Script = (tools: Tools, request: ToolRunRequest) => Promise<void>;

/** A model that follows a script: calls the step's tools directly and reports some usage. No network. */
class ScriptedModel implements ModelClient {
  readonly requests: ToolRunRequest[] = [];
  constructor(private readonly script: Script) {}
  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([]);
  }
  check(): Promise<void> {
    return Promise.resolve();
  }
  async runTools(request: ToolRunRequest, meter: UsageMeter) {
    this.requests.push(request);
    meter.add({ input_tokens: 1000, output_tokens: 100 });
    await this.script(Object.fromEntries(request.tools.map((t) => [t.name, t])), request);
    return { text: 'done' };
  }
}

const call = (tools: Tools, name: string, input: unknown): Promise<string> => {
  const tool = tools[name];
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool.run(input as never);
};

describe('characterizationTestPath', () => {
  it('puts the tests next to the file with a fixed suffix', () => {
    expect(characterizationTestPath('src/components/Card.jsx')).toBe(
      'src/components/Card.characterization.test.jsx',
    );
    expect(characterizationTestPath('src/api.js')).toBe('src/api.characterization.test.js');
  });
});

describe('confine', () => {
  it.each([
    ['../../etc/passwd', 'outside the project'],
    ['/etc/passwd', 'absolute paths'],
    ['node_modules/react/index.js', 'node_modules'],
    ['.git/config', 'node_modules and .git'],
    ['.env.local', 'environment files'],
  ])('refuses %s', async (path, reason) => {
    const root = await mkdtemp(join(tmpdir(), 'modernizer-confine-'));

    await expect(confine(root, path)).rejects.toThrow(reason);
  });

  it('refuses a link that leads outside', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modernizer-confine-'));
    const outside = await mkdtemp(join(tmpdir(), 'modernizer-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(root, 'escape'));

    await expect(confine(root, 'escape/secret.txt')).rejects.toThrow('through a link');
  });

  it('accepts a path inside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modernizer-confine-'));

    expect(await confine(root, 'src/Card.jsx')).toBe(join(root, 'src/Card.jsx'));
  });
});

describe('tools', () => {
  async function toolsIn(testCommand = 'grep -q expect {testFile}') {
    const cwd = await mkdtemp(join(tmpdir(), 'modernizer-tools-'));
    await mkdir(join(cwd, 'src'));
    await writeFile(join(cwd, 'src/Card.jsx'), 'export const Card = () => null;\n');
    const bugs: unknown[] = [];
    const tools = Object.fromEntries(
      createTools({
        cwd,
        testPath: 'src/Card.characterization.test.jsx',
        testCommand,
        timeoutSeconds: 30,
        report: (b) => bugs.push(b),
      }).map((t) => [t.name, t]),
    );
    return { cwd, tools, bugs };
  }

  it('offers no way to write any file but the test file', async () => {
    const { tools } = await toolsIn();

    expect(Object.keys(tools).sort()).toEqual([
      'list_directory',
      'read_file',
      'report_bug',
      'run_tests',
      'write_test_file',
    ]);
    // write_test_file takes content only — there is no path to point at the source.
    expect(
      Object.keys((tools.write_test_file?.inputSchema as unknown as { shape: object }).shape),
    ).toEqual(['content']);
  });

  it('writes the test file, runs it, reads and lists the project, records bugs', async () => {
    const { cwd, tools, bugs } = await toolsIn();

    expect(await call(tools, 'read_file', { path: 'src/Card.jsx' })).toContain('Card');
    expect(await call(tools, 'list_directory', { path: '.' })).toBe('src/');
    await call(tools, 'write_test_file', { content: 'test("x", () => expect(1).toBe(1));\n' });
    expect(await readFile(join(cwd, 'src/Card.characterization.test.jsx'), 'utf8')).toContain(
      'expect',
    );
    expect(await call(tools, 'run_tests', {})).toMatch(/^PASSED/);
    await call(tools, 'report_bug', { line: 3, reason: 'off by one' });
    expect(bugs).toEqual([{ line: 3, reason: 'off by one' }]);
  });

  it('reports failing tests to the model', async () => {
    const { tools } = await toolsIn('echo "1 failed" && exit 1');

    expect(await call(tools, 'run_tests', {})).toBe('FAILED\n1 failed');
  });
});

describe('instructions', () => {
  it('state every rule for the tests', () => {
    for (const rule of [
      'current behaviour',
      'report_bug',
      'React Testing Library',
      'implementation details',
      'toMatchSnapshot',
      'no real network',
      'fake timers',
      'renderWithProviders',
      'Finish only when run_tests reports PASSED',
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  it('name the helpers, an existing test, and the previous failure', () => {
    const prompt = buildPrompt({
      file: 'src/Card.jsx',
      testPath: 'src/Card.characterization.test.jsx',
      helpers: ['src/test-utils.js'],
      existingTest: 'src/Card.test.jsx',
      previousFailure: 'forbidden patterns failed: toMatchSnapshot',
    });

    expect(prompt).toContain('Test helpers to use: src/test-utils.js');
    expect(prompt).toContain('src/Card.test.jsx');
    expect(prompt).toContain('forbidden patterns failed: toMatchSnapshot');
    expect(prompt).not.toContain('must cover');
    expect(
      buildPrompt({ file: 'a.js', testPath: 'a.t.js', helpers: [], coverageMin: 80 }),
    ).toContain('The tests must cover at least 80% of the file');
  });
});

describe('characterize-tests in a run', () => {
  const APP = {
    'src/api.js': 'export const api = () => 1;\n',
    'src/Card.jsx': "import { api } from './api';\nexport const Card = () => api();\n",
    'src/Card.test.jsx': "test('existing', () => {});\n",
  };

  function config(root: string, helpers: string[] = []) {
    return parseConfig({
      target: root,
      steps: {
        analyze: { enabled: false },
        'class-to-function': { enabled: false },
        'js-to-ts': { enabled: false },
        simplify: { enabled: false },
        'characterize-tests': { testCommand: 'grep -q expect {testFile}', helpers },
      },
      // Coverage has its own tests; here it would need a real Jest.
      gates: { commands: ['test -f {files}'], coverage: { min: 0 } },
      retry: { perStep: 1 },
    });
  }

  const passingTest = (file: string) =>
    `import x from './${file}';\ntest('behaves', () => { expect(x).toBeDefined(); });\n`;

  it('writes passing tests for each file and commits only the test files', async () => {
    const root = await tempRepo(APP);
    const model = new ScriptedModel(async (tools, request) => {
      const file = /File under test: (\S+)/.exec(request.prompt)?.[1] ?? '';
      await call(tools, 'read_file', { path: file });
      await call(tools, 'write_test_file', { content: passingTest(file) });
      expect(await call(tools, 'run_tests', {})).toMatch(/^PASSED/);
    });
    const cfg = config(root);

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, model),
      log: () => undefined,
    });

    expect(summary).toMatchObject({ done: 2, failed: 0 });
    expect(sh(root, 'diff', '--name-only', 'main', 'modernizer/run').split('\n')).toEqual([
      'src/Card.characterization.test.jsx',
      'src/api.characterization.test.js',
    ]);
    expect(sh(root, 'show', 'modernizer/run:src/Card.test.jsx')).toBe(
      "test('existing', () => {});",
    );
    const cardPrompt = model.requests.find((r) => r.prompt.includes('src/Card.jsx'))?.prompt;
    expect(cardPrompt).toContain('Existing tests you may read for context');
    expect(model.requests[0]?.model).toBe('claude-sonnet-5');
    expect(model.requests[0]?.effort).toBe('high');
  });

  it('rejects snapshot tests and lets the model fix them with the failure', async () => {
    const root = await tempRepo({ 'src/api.js': 'export const api = () => 1;\n' });
    const model = new ScriptedModel(async (tools, request) => {
      const snapshot = !request.prompt.includes('toMatchSnapshot');
      await call(tools, 'write_test_file', {
        content: snapshot
          ? "test('x', () => { expect(1).toMatchSnapshot(); });\n"
          : "test('x', () => { expect(1).toBe(1); });\n",
      });
    });
    const cfg = config(root);

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, model),
      log: () => undefined,
    });

    expect(summary.done).toBe(1);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.prompt).toContain('forbidden patterns');
    expect(sh(root, 'show', 'modernizer/run:src/api.characterization.test.js')).not.toContain(
      'toMatchSnapshot',
    );
  });

  it('fails a file whose model writes no tests', async () => {
    const root = await tempRepo({ 'src/api.js': 'export const api = () => 1;\n' });
    const cfg = config(root);
    const idle = new ScriptedModel(() => Promise.resolve());

    const summary = await runModernizer({
      config: cfg,
      steps: createBuiltInSteps(cfg, idle),
      log: () => undefined,
    });

    expect(summary.failed).toBe(1);
  });

  it('refuses to start without credentials, with a message and no stack trace', async () => {
    const root = await tempRepo({ 'src/api.js': 'export const api = () => 1;\n' });
    const yaml = join(root, '..', `${root.split('/').pop() ?? 'x'}-nokey.yaml`);
    await writeFile(
      yaml,
      `target: ${JSON.stringify(root)}\nsteps:\n  analyze: { enabled: false }\n  class-to-function: { enabled: false }\n  js-to-ts: { enabled: false }\n  simplify: { enabled: false }\n`,
    );
    const noAccess: ModelClient = {
      listModels: () => Promise.resolve([]),
      check: () =>
        Promise.reject(
          new ModelAccessError('No credentials for the model API: set ANTHROPIC_API_KEY'),
        ),
      runTools: () => Promise.reject(new Error('must not be called')),
    };
    let err = '';

    const code = await main(
      ['run', yaml],
      { stdout: () => undefined, stderr: (t) => (err += t) },
      (c) => createBuiltInSteps(c, noAccess),
    );

    expect(code).toBe(1);
    expect(err).toBe('No credentials for the model API: set ANTHROPIC_API_KEY\n');
    // Refused before anything is created: no run branch, no worktrees.
    expect(sh(root, 'branch', '--list', 'modernizer/run')).toBe('');
    expect(sh(root, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('records a reported bug and shows it in status, with the tokens used', async () => {
    const root = await tempRepo({
      'src/List.jsx': 'export const List = ({ items }) => items.slice(1);\n',
    });
    const model = new ScriptedModel(async (tools) => {
      await call(tools, 'report_bug', { line: 1, reason: 'drops the first item' });
      await call(tools, 'write_test_file', { content: passingTest('List') });
    });
    const yaml = join(root, '..', `${root.split('/').pop() ?? 'x'}-char.yaml`);
    await writeFile(
      yaml,
      [
        `target: ${JSON.stringify(root)}`,
        'steps:',
        '  analyze: { enabled: false }',
        '  class-to-function: { enabled: false }',
        '  js-to-ts: { enabled: false }',
        '  simplify: { enabled: false }',
        "  characterize-tests: { testCommand: 'grep -q expect {testFile}' }",
        'gates:',
        "  commands: ['test -f {files}']",
        '  coverage: { min: 0 }',
        '',
      ].join('\n'),
    );
    const io = { out: '', err: '' };
    const streams = { stdout: (t: string) => (io.out += t), stderr: (t: string) => (io.err += t) };

    expect(await main(['run', yaml], streams, (c) => createBuiltInSteps(c, model))).toBe(0);
    io.out = '';
    await main(['status', yaml], streams);

    expect(io.out).toContain('Tokens: 1100 (input 1000 · output 100) · reported bugs: 1');
    expect(io.out).toContain('src/List.jsx:1  drops the first item');
  });
});
