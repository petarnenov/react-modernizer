import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compact } from '../src/model/ollama.js';
import { testTool } from '../src/steps/js-to-ts/step.js';

const read = (turn: number, path: string, content: string) => ({
  role: 'tool' as const,
  tool_name: 'read_file',
  content,
  turn,
  path,
  note: `[earlier result of read_file ${path} omitted — call it again if you need it]`,
});
const said = (turn: number, thinking: string) => ({
  role: 'assistant' as const,
  content: `turn ${String(turn)}`,
  thinking,
  turn,
});

const HISTORY = [
  { role: 'system' as const, content: 'system' },
  { role: 'user' as const, content: 'task' },
  said(0, 'long reasoning 0'),
  read(0, 'src/Card.js', 'CARD v1'),
  read(0, 'src/other.ts', 'OTHER'),
  said(5, 'long reasoning 5'),
  read(5, 'src/Card.js', 'CARD v2'),
  said(8, 'long reasoning 8'),
];

describe('compaction keeps what the step needs', () => {
  const sent = compact(HISTORY, 9, ['src/Card.js', 'src/Card.test.js']);

  it('sends the latest read of an own file in full, however old', () => {
    expect(sent[6]).toEqual({ role: 'tool', tool_name: 'read_file', content: 'CARD v2' });
  });

  it('turns a superseded read of an own file into a note', () => {
    expect(sent[3]?.content).toBe(
      '[earlier result of read_file src/Card.js omitted — call it again if you need it]',
    );
  });

  it('still notes old reads of other files', () => {
    expect(sent[4]?.content).toContain('omitted');
  });

  it('drops old reasoning, keeps recent reasoning, text and order', () => {
    expect(sent[2]).toEqual({ role: 'assistant', content: 'turn 0' });
    expect(sent[5]).toEqual({ role: 'assistant', content: 'turn 5' });
    expect(sent[7]).toEqual({ role: 'assistant', content: 'turn 8', thinking: 'long reasoning 8' });
    expect(sent.map((m) => m.role)).toEqual(HISTORY.map((m) => m.role));
  });

  it('keeps an own file read only once in full at any age', () => {
    expect(compact(HISTORY.slice(0, 5), 30, ['src/Card.js'])[3]?.content).toBe('CARD v1');
  });
});

describe('js-to-ts runs its own test', () => {
  it('runs the command with the renamed test file and nothing else', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'modernizer-trim-'));
    await writeFile(join(cwd, 'ran.sh'), 'echo "$@"\n');
    const tool = testTool(
      cwd,
      'sh ran.sh {testFile}',
      'src/Card.tsx',
      'src/Card.characterization.test.tsx',
      30,
    );

    expect(await tool.run({} as never)).toBe('PASSED\nsrc/Card.characterization.test.tsx');
  });

  it('runs nothing without a characterization test, and says so', async () => {
    const tool = testTool(tmpdir(), 'false {testFile}', 'src/format.ts', undefined, 30);

    expect(await tool.run({} as never)).toBe(
      'no characterization test for src/format.ts; nothing to run',
    );
  });

  it('keeps a custom command without {testFile} working as before', async () => {
    const tool = testTool(tmpdir(), 'echo {file}', 'src/format.ts', undefined, 30);

    expect(await tool.run({} as never)).toBe('PASSED\nsrc/format.ts');
  });
});
