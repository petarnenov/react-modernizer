import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterModels,
  initialState,
  press,
  renderPicker,
  type PickerKey,
} from '../src/cli/pick.js';
import { main } from '../src/cli.js';
import type { ModernizerConfig } from '../src/config/schema.js';
import type { ModelClient, ModelInfo } from '../src/model/client.js';
import { tempRepo } from './helpers/repo.js';

const MODELS: ModelInfo[] = [
  { name: 'glm-5.3', size: 756e9, modifiedAt: '2026-09-12T10:00:00Z' },
  { name: 'kimi-k2.6', size: 1.1e12, modifiedAt: '2026-08-20T10:00:00Z' },
  { name: 'glm-5.1', size: 756e9, modifiedAt: '2026-06-03T10:00:00Z' },
  { name: 'qwen3-coder:480b', size: 510e9 },
];

const typed = (text: string): PickerKey[] =>
  Array.from(text, (c): PickerKey => ({ kind: 'char', text: c }));
const run = (keys: PickerKey[], current?: string) =>
  keys.reduce(press, initialState(MODELS, current));

describe('filterModels', () => {
  it('keeps names containing every word, in any order and case', () => {
    expect(filterModels(MODELS, 'glm 5.3').map((m) => m.name)).toEqual(['glm-5.3']);
    expect(filterModels(MODELS, '5 GLM').map((m) => m.name)).toEqual(['glm-5.3', 'glm-5.1']);
    expect(filterModels(MODELS, '  ')).toHaveLength(4);
    expect(filterModels(MODELS, 'llama')).toEqual([]);
  });
});

describe('picker', () => {
  it('preselects the configured model', () => {
    expect(run([], 'glm-5.1').selected).toBe(2);
    expect(run([], 'not-listed').selected).toBe(0);
  });

  it('filters as the user types and chooses with Enter', () => {
    expect(run([...typed('glm 5.3'), { kind: 'enter' }]).done).toEqual({ chosen: 'glm-5.3' });
  });

  it('keeps the selected model while it still matches, and backspace widens again', () => {
    const state = run([{ kind: 'down' }, { kind: 'down' }, ...typed('glm')]);
    expect(state.matches[state.selected]?.name).toBe('glm-5.1');

    const wider = run([
      ...typed('kimi'),
      { kind: 'backspace' },
      { kind: 'backspace' },
      { kind: 'backspace' },
      { kind: 'backspace' },
    ]);
    expect(wider.matches).toHaveLength(4);
  });

  it('keeps the arrows inside the list', () => {
    expect(run([{ kind: 'up' }]).selected).toBe(0);
    expect(run(Array.from({ length: 9 }, (): PickerKey => ({ kind: 'down' }))).selected).toBe(3);
  });

  it('does nothing on Enter when nothing matches', () => {
    expect(run([...typed('llama'), { kind: 'enter' }]).done).toBeUndefined();
  });

  it('cancels on Escape and ignores keys afterwards', () => {
    expect(run([{ kind: 'cancel' }, { kind: 'enter' }]).done).toEqual({ cancelled: true });
  });

  it('renders the prompt, at most ten rows with size and date, and the count', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      name: `model-${String(i).padStart(2, '0')}`,
    }));
    const lines = renderPicker(initialState(many, 'model-20'), 'Model (ollama)');

    expect(lines[0]).toBe('Model (ollama) › ');
    expect(lines.slice(1, -1)).toHaveLength(10);
    expect(lines).toContain('  ❯ model-20');
    expect(lines.at(-1)).toBe('  25 of 25 · ↑↓ move · Enter choose · Esc cancel');

    expect(renderPicker(run(typed('glm')), 'M').slice(1, 3)).toEqual([
      '  ❯ glm-5.3  756 GB · 2026-09-12',
      '    glm-5.1  756 GB · 2026-06-03',
    ]);
    expect(renderPicker(run(typed('zzz')), 'M')[1]).toBe('    no model matches');
  });
});

const lister =
  (models: ModelInfo[] = MODELS) =>
  (): ModelClient => ({
    listModels: () => Promise.resolve(models),
    check: () => Promise.resolve(),
    runTools: () => Promise.reject(new Error('not used')),
  });

async function project(extra = '') {
  const root = await tempRepo({ 'src/a.js': 'export const a = 1;\n' });
  const yaml = join(root, '..', `${root.split('/').pop() ?? 'x'}.yaml`);
  const text =
    `target: ${JSON.stringify(root)}\n` +
    'model: { provider: ollama, default: glm-5.3 }\n' +
    'steps: { analyze: { enabled: false }, characterize-tests: { enabled: false }, class-to-function: { enabled: false }, js-to-ts: { enabled: false }, simplify: { enabled: false } }\n' +
    `gates: { commands: ['true'], coverage: { min: 0 } }\n${extra}`;
  await writeFile(yaml, text);
  return { yaml, text };
}

function capture(extra: Partial<Parameters<typeof main>[1]> = {}) {
  const out = { stdout: '', stderr: '' };
  const io = {
    stdout: (t: string) => (out.stdout += t),
    stderr: (t: string) => (out.stderr += t),
    ...extra,
  };
  return { out, io };
}

describe('models command', () => {
  it('lists the models newest first, marking the configured one', async () => {
    const { yaml } = await project();
    const { out, io } = capture();

    expect(await main(['models', yaml], io, {}, lister())).toBe(0);

    expect(out.stdout.split('\n').slice(0, 3)).toEqual([
      '4 models (ollama · https://ollama.com), newest first:',
      '* glm-5.3           756 GB · 2026-09-12',
      '  kimi-k2.6         1100 GB · 2026-08-20',
    ]);
  });

  it('prints JSON with --json', async () => {
    const { yaml } = await project();
    const { out, io } = capture();

    await main(['models', yaml, '--json'], io, {}, lister());

    expect(JSON.parse(out.stdout)).toEqual(MODELS);
  });
});

describe('run with a model chosen at run time', () => {
  const seenModel = () => {
    const seen: string[] = [];
    return { seen, stepsFor: (c: ModernizerConfig) => (seen.push(c.model.default), {}) };
  };

  it('--model overrides model.default without changing the file', async () => {
    const { yaml, text } = await project();
    const { seen, stepsFor } = seenModel();
    const { out, io } = capture();

    expect(await main(['run', yaml, '--model', 'kimi-k2.6'], io, stepsFor, lister())).toBe(0);

    expect(seen).toEqual(['kimi-k2.6']);
    expect(out.stdout).toContain('model: kimi-k2.6');
    expect(await readFile(yaml, 'utf8')).toBe(text);
  });

  it('--pick-model runs with the chosen model and names steps that keep their own', async () => {
    const { yaml } = await project('\n');
    const withOwn = yaml.replace(/\.yaml$/, '-own.yaml');
    await writeFile(
      withOwn,
      (await readFile(yaml, 'utf8')).replace(
        'analyze: { enabled: false }',
        'analyze: { model: glm-5.1, minLines: 1000 }',
      ),
    );
    const { seen, stepsFor } = seenModel();
    const offered: string[][] = [];
    const { out, io } = capture({
      terminal: true,
      pickModel: (models, current) => {
        offered.push([current, ...models.map((m) => m.name)]);
        return Promise.resolve('qwen3-coder:480b');
      },
    });

    await main(['run', withOwn, '--pick-model'], io, stepsFor, lister());

    expect(offered).toEqual([['glm-5.3', 'glm-5.3', 'kimi-k2.6', 'glm-5.1', 'qwen3-coder:480b']]);
    expect(seen).toEqual(['qwen3-coder:480b']);
    expect(out.stdout).toContain('note: analyze keeps its own model glm-5.1');
  });

  it('cancelling the picker runs nothing', async () => {
    const { yaml } = await project();
    const { seen, stepsFor } = seenModel();
    const { out, io } = capture({ terminal: true, pickModel: () => Promise.resolve(undefined) });

    expect(await main(['run', yaml, '--pick-model'], io, stepsFor, lister())).toBe(130);

    expect(seen).toEqual([]);
    expect(out.stderr).toBe('cancelled\n');
  });

  it('--pick-model without a terminal is refused, naming --model', async () => {
    const { yaml } = await project();
    const { out, io } = capture();

    expect(await main(['run', yaml, '--pick-model'], io, {}, lister())).toBe(1);

    expect(out.stderr).toContain('--model <name>');
  });
});
