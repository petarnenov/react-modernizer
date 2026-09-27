import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compact, recordRead } from '../src/model/ollama.js';
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
  const sent = compact(HISTORY, 9);

  it('sends the latest read of a file in full, however old', () => {
    expect(sent[6]).toEqual({ role: 'tool', tool_name: 'read_file', content: 'CARD v2' });
  });

  it('turns a superseded read of a file into a note', () => {
    expect(sent[3]?.content).toBe(
      '[earlier result of read_file src/Card.js omitted — call it again if you need it]',
    );
  });

  it("keeps an old read of any file, not only the step's own", () => {
    expect(sent[4]?.content).toBe('OTHER');
  });

  it('still notes old results of other tools', () => {
    const tests = {
      role: 'tool' as const,
      tool_name: 'run_tests',
      content: 'PASSED',
      turn: 1,
      note: '[run_tests]',
    };
    expect(compact([...HISTORY, tests], 9).at(-1)?.content).toBe('[run_tests]');
  });

  it('drops old reasoning, keeps recent reasoning, text and order', () => {
    expect(sent[2]).toEqual({ role: 'assistant', content: 'turn 0' });
    expect(sent[5]).toEqual({ role: 'assistant', content: 'turn 5' });
    expect(sent[7]).toEqual({ role: 'assistant', content: 'turn 8', thinking: 'long reasoning 8' });
    expect(sent.map((m) => m.role)).toEqual(HISTORY.map((m) => m.role));
  });

  it('keeps a file read only once in full at any age', () => {
    expect(compact(HISTORY.slice(0, 5), 30)[3]?.content).toBe('CARD v1');
  });
});

describe('an unchanged file read again', () => {
  it('comes back as a note, and the earlier read stays in full', () => {
    const recorded = recordRead(HISTORY, 'src/other.ts', 'OTHER');
    expect(recorded).toEqual({
      content:
        '[src/other.ts is unchanged since your read on turn 1; that result is still above, in full]',
    });

    const sent = compact(
      [...HISTORY, { role: 'tool', tool_name: 'read_file', turn: 9, ...recorded }],
      20,
    );
    expect(sent[4]?.content).toBe('OTHER');
  });

  it('comes back in full when the file changed, superseding the earlier read', () => {
    expect(recordRead(HISTORY, 'src/Card.js', 'CARD v3')).toEqual({
      content: 'CARD v3',
      path: 'src/Card.js',
    });
    expect(recordRead(HISTORY, 'src/Card.js', 'CARD v2')).not.toHaveProperty('path');
  });

  it('keeps errors as they are', () => {
    expect(recordRead(HISTORY, 'src/gone.ts', 'Error: no such file')).toEqual({
      content: 'Error: no such file',
    });
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
