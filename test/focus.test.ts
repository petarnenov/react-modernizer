import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.js';
import { indexImporters, sourceRoots } from '../src/graph/importers.js';
import { compact } from '../src/model/ollama.js';
import { BudgetExceededError } from '../src/model/usage.js';
import { runModernizer } from '../src/run/runner.js';
import { loadState } from '../src/run/state.js';
import { buildPrompt, SYSTEM_PROMPT } from '../src/steps/js-to-ts/instructions.js';
import type { Importer, Step } from '../src/steps/step.js';
import { tempRepo, runStatePath } from './helpers/repo.js';

const ONLY_SIMPLIFY = {
  analyze: { enabled: false },
  'characterize-tests': { enabled: false },
  'class-to-function': { enabled: false },
  'js-to-ts': { enabled: false },
};

describe('importers across the project', () => {
  it('takes the source roots from the include patterns', () => {
    expect(sourceRoots(['src/**/*.{js,jsx}', 'src/pages/Card.js'])).toEqual(['src']);
    expect(sourceRoots(['src/a.js', 'lib/**/*.ts'])).toEqual(['lib', 'src']);
    expect(sourceRoots(['**/*.js'])).toEqual(['']);
  });

  it('finds importers the run does not process, TypeScript included', async () => {
    const root = await tempRepo({
      'src/Card.jsx': 'export const Card = () => null;\n',
      'src/Page.tsx': "import { Card } from './Card';\nexport const Page = () => Card;\n",
      'src/lazy.ts': "export const load = () => import('./Card.jsx');\n",
      'src/types.d.ts': "import './Card';\n",
    });

    const index = await indexImporters(root, { include: ['src/Card.jsx'], exclude: [] });

    expect(index.get('src/Card.jsx')).toEqual([
      { file: 'src/Page.tsx', specifier: './Card' },
      { file: 'src/lazy.ts', specifier: './Card.jsx' },
    ]);
  });

  it('reach the steps in a run that includes only the one file', async () => {
    const root = await tempRepo({
      'src/Card.jsx': 'export const Card = () => null;\n',
      'src/Page.tsx': "import { Card } from './Card';\nexport const Page = () => Card;\n",
    });
    const seen: (readonly Importer[])[] = [];
    const step: Step = {
      id: 'simplify',
      run: (ctx) => {
        seen.push(ctx.importers);
        return Promise.resolve();
      },
    };
    const config = parseConfig({
      target: root,
      source: { include: ['src/Card.jsx'] },
      steps: ONLY_SIMPLIFY,
      gates: { commands: ['true'] },
    });

    await runModernizer({ config, steps: { simplify: step }, log: () => undefined });

    expect(seen).toEqual([[{ file: 'src/Page.tsx', specifier: './Card' }]]);
  });
});

describe('js-to-ts and its importers', () => {
  it('tells the model it cannot change importers and must fit its types to them', () => {
    for (const rule of [
      'You cannot change them',
      'your types must fit how they use your module',
      'Adjust your own types to fit it',
      'read the lines around the reported error',
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  it('lists up to 20 importers and counts the rest', () => {
    const importers = Array.from(
      { length: 45 },
      (_, i) => `src/p${String(i).padStart(2, '0')}.tsx`,
    );

    const prompt = buildPrompt({ from: 'src/a.js', file: 'src/a.ts', helpers: [], importers });

    expect(prompt).toContain('src/p00.tsx');
    expect(prompt).toContain('src/p19.tsx');
    expect(prompt).not.toContain('src/p20.tsx');
    expect(prompt).toContain('and 25 more');
  });

  it('points out on a retry that the errors are in files it cannot change', () => {
    const prompt = buildPrompt({
      from: 'src/a.js',
      file: 'src/a.ts',
      helpers: [],
      previousFailure:
        "tsc failed:\n1 new error(s); errors that were there before are not shown:\nsrc/Page.tsx(3,9): error TS2345: Argument of type 'string'…",
    });

    expect(prompt).toContain('Errors are reported in files you cannot change (src/Page.tsx)');
    expect(
      buildPrompt({
        from: 'src/a.js',
        file: 'src/a.ts',
        helpers: [],
        previousFailure: 'tsc failed:\nsrc/a.ts(1,1): error TS1: own',
      }),
    ).not.toContain('files you cannot change (');
  });
});

describe('Ollama history compaction', () => {
  const tool = (turn: number, name: string, content: string) => ({
    role: 'tool' as const,
    tool_name: name,
    content,
    turn,
    note: `[earlier result of ${name} omitted — call it again if you need it]`,
  });
  const messages = [
    { role: 'system' as const, content: 'system' },
    { role: 'user' as const, content: 'task' },
    { role: 'assistant' as const, content: '', thinking: 'read it' },
    tool(0, 'read_file', 'FILE CONTENT'),
    { role: 'assistant' as const, content: '' },
    tool(7, 'run_tests', 'FAILED …'),
  ];

  it('sends old tool results as a note and recent ones in full, keeping everything else', () => {
    const sent = compact(messages, 9);

    expect(sent.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    expect(sent[3]).toEqual({
      role: 'tool',
      tool_name: 'read_file',
      content: '[earlier result of read_file omitted — call it again if you need it]',
    });
    expect(sent[5]).toEqual({ role: 'tool', tool_name: 'run_tests', content: 'FAILED …' });
    expect(sent[2]).toEqual({ role: 'assistant', content: '', thinking: 'read it' });
  });

  it('keeps the results of the last two turns', () => {
    expect(compact(messages, 2)[3]?.content).toBe('FILE CONTENT');
    expect(compact(messages, 3)[3]?.content).toContain('omitted');
  });
});

describe('failure reason', () => {
  it('keeps the last gate failure when the budget ends the attempts', async () => {
    const root = await tempRepo({ 'src/Card.js': 'export const a = 1;\n' });
    let attempt = 0;
    const step: Step = {
      id: 'simplify',
      run: async (ctx) => {
        attempt++;
        if (attempt === 1) {
          await writeFile(join(ctx.cwd, 'src/Card.js'), 'export const a = 2; // BROKEN\n');
          return;
        }
        throw new BudgetExceededError(
          'token budget exhausted: 510 of 500 (budget.maxTokensPerFile)',
        );
      },
    };
    const config = parseConfig({
      target: root,
      steps: ONLY_SIMPLIFY,
      gates: { commands: ['grep -n BROKEN src/Card.js && exit 1 || true'], coverage: { min: 0 } },
      retry: { perStep: 1 },
    });

    await runModernizer({ config, steps: { simplify: step }, log: () => undefined });

    const state = await loadState(runStatePath(root));
    const reason = state?.files['src/Card.js']?.reason ?? '';
    expect(reason).toContain('budget.maxTokensPerFile');
    expect(reason).toContain('last gate failure:');
    expect(reason).toContain('1:export const a = 2; // BROKEN');
  });
});
