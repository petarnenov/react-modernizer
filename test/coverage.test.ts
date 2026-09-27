import { appendFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverageGate, formatRanges, lineCoverage } from '../src/run/coverage.js';
import { Semaphore } from '../src/run/gates.js';
import { openRepository } from '../src/run/git.js';
import { countTests, weakening } from '../src/run/protection.js';
import { processFile, type FileJob } from '../src/run/transaction.js';
import { createWorktrees, worktreeDirectory } from '../src/run/workspace.js';
import type { Step, StepContext } from '../src/steps/step.js';
import { sh, tempRepo } from './helpers/repo.js';

/**
 * A stand-in for Jest: without --coverage it passes; with it, it writes a real coverage-final.json where every
 * non-empty line of the covered file is a statement, and a line ran when a test file says `// covers: 1,3`.
 * It logs each --collectCoverageFrom it was given.
 */
const FAKE_JEST = `
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
if (!args.includes('--coverage')) process.exit(0);
const dir = flag('coverageDirectory'), file = flag('collectCoverageFrom');
appendFileSync(process.env.FAKE_JEST_LOG, file + '\\n');
const tests = args.filter((a) => !a.startsWith('--'));
const covered = new Set(tests.flatMap((t) => [...readFileSync(t, 'utf8').matchAll(/covers: ([\\d,]+)/g)].flatMap((m) => m[1].split(',').map(Number))));
const statementMap = {}, s = {};
readFileSync(file, 'utf8').split('\\n').forEach((text, i) => {
  if (text.trim() === '') return;
  statementMap[i] = { start: { line: i + 1 } };
  s[i] = covered.has(i + 1) ? 1 : 0;
});
mkdirSync(dir, { recursive: true });
writeFileSync(dir + '/coverage-final.json', JSON.stringify({ [resolve(file)]: { statementMap, s } }));
`;

async function fakeJest(): Promise<{ runner: string; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'modernizer-fakejest-'));
  const script = join(dir, 'jest.mjs');
  const log = join(dir, 'log');
  await writeFile(script, FAKE_JEST);
  await writeFile(log, '');
  return { runner: `FAKE_JEST_LOG='${log}' node '${script}'`, log };
}

describe('lineCoverage and formatRanges', () => {
  const report = {
    '/p/src/a.js': {
      statementMap: {
        0: { start: { line: 1 } },
        1: { start: { line: 2 } },
        2: { start: { line: 2 } },
        3: { start: { line: 5 } },
      },
      s: { 0: 1, 1: 0, 2: 3, 3: 0 },
    },
    '/p/src/empty.js': { statementMap: {}, s: {} },
  };

  it('counts a line covered when any statement on it ran', () => {
    expect(lineCoverage(report, ['/p/src/a.js'])).toEqual({ percent: 66.7, uncovered: [5] });
  });

  it('is 0% for a file the tests never loaded and 100% for one without statements', () => {
    expect(lineCoverage(report, ['/p/src/missing.js'])).toEqual({ percent: 0, uncovered: [] });
    expect(lineCoverage(report, ['/p/src/empty.js'])).toEqual({ percent: 100, uncovered: [] });
  });

  it('compacts lines into ranges', () => {
    expect(formatRanges([12, 13, 14, 15, 16, 17, 18, 30])).toBe('12–18, 30');
    expect(formatRanges([])).toBe('');
  });
});

describe('coverageGate', () => {
  it('leaves no coverage directory behind', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'modernizer-cov-'));
    await writeFile(join(cwd, 'a.js'), 'x\n');
    await writeFile(join(cwd, 'a.test.js'), '// covers: 1\n');
    const { runner } = await fakeJest();
    const spy = `sh -c 'for a; do case "$a" in --coverageDirectory=*) echo "\${a#*=}" > ${cwd}/dir;; esac; done; ${runner.replaceAll("'", '"')} "$@"' --`;

    const result = await coverageGate({
      testRunner: spy,
      cwd,
      file: 'a.js',
      tests: ['a.test.js'],
      min: 80,
      timeoutSeconds: 30,
      semaphore: new Semaphore(1),
    });
    const used = (await readFile(join(cwd, 'dir'), 'utf8')).trim().replaceAll("'", '');

    expect(result).toEqual({ ok: true });
    const { existsSync } = await import('node:fs');
    expect(existsSync(used)).toBe(false);
  });
});

describe('countTests and weakening', () => {
  const tests = `
    // it('in a comment', () => expect(1).toBe(1));
    describe('Card', () => {
      it('renders', () => { expect(a).toBe(1); expect(b).toBe(2); });
      test('clicks', () => expect(c).toBe(3));
      it.each([[1], [2]])('value %s', (v) => expect(v).toBeTruthy());
      const s = "it('not a test')";
    });`;

  it('counts cases and assertions from the syntax, not the text', () => {
    expect(countTests('a.test.jsx', tests)).toEqual({ cases: 3, assertions: 4, disabled: [] });
  });

  it.each([
    ['it.skip', "it.skip('x', () => {})"],
    ['it.only', "it.only('x', () => {})"],
    ['test.todo', "test.todo('x')"],
    ['describe.skip', "describe.skip('x', () => {})"],
    ['xit', "xit('x', () => {})"],
    ['xdescribe', "xdescribe('x', () => {})"],
    ['fit', "fit('x', () => {})"],
    ['it.skip.each', "it.skip.each([[1]])('x %s', () => {})"],
  ])('marks %s as disabled', (marker, code) => {
    expect(countTests('a.test.js', code).disabled).toEqual([`${marker} at line 1`]);
  });

  it('describes what got weaker', () => {
    const before = { cases: 3, assertions: 12, disabled: [] };

    expect(weakening('a.test.js', before, { cases: 3, assertions: 11, disabled: [] })).toBe(
      'protected tests a.test.js weakened: assertions dropped from 12 to 11',
    );
    expect(weakening('a.test.js', before, { ...before, assertions: 13 })).toBeUndefined();
  });
});

describe('coverage and protection in the pipeline', () => {
  const SOURCE = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nexport { a, b, c, d };\n';

  async function job(
    steps: Step[],
    gates: Partial<FileJob['gates']> = {},
  ): Promise<FileJob & { log: string }> {
    const root = await tempRepo({ 'src/Card.jsx': SOURCE });
    const repo = await openRepository(root);
    const base = sh(root, 'rev-parse', 'HEAD');
    const [worktree] = await createWorktrees(
      repo,
      worktreeDirectory(repo, 'r'),
      1,
      base,
      join(root, 'nm'),
    );
    if (worktree === undefined) throw new Error('worktree missing');
    const { runner, log } = await fakeJest();
    return {
      file: 'src/Card.jsx',
      worktree,
      base,
      steps,
      retries: 1,
      log,
      gates: {
        commands: [{ run: 'true' }],
        forbid: [],
        timeoutSeconds: 30,
        semaphore: new Semaphore(1),
        testRunner: runner,
        coverageMin: 80,
        protectTestsFrom: 'characterize-tests',
        ...gates,
      },
    };
  }

  const testFile = (file: string) => file.replace(/\.(jsx?|tsx?)$/, '.characterization.test.$1');
  const TESTS =
    "it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });\nit('b', () => expect(3).toBe(3));\n";

  /** Writes tests covering the given lines; on a retry, covers every line. */
  function characterize(lines: string, calls: StepContext[] = []): Step {
    return {
      id: 'characterize-tests',
      allowedChanges: (f) => [testFile(f)],
      producesTests: (f) => [testFile(f)],
      async run(ctx) {
        calls.push(ctx);
        const covers = ctx.previousFailure === undefined ? lines : '1,2,3,4,5';
        await writeFile(join(ctx.cwd, testFile(ctx.file)), `${TESTS}// covers: ${covers}\n`);
      },
    };
  }

  function later(change: (cwd: string) => Promise<void>): Step {
    return { id: 'js-to-ts', run: (ctx) => change(ctx.cwd) };
  }

  it('passes with enough coverage and commits', async () => {
    const result = await processFile(await job([characterize('1,2,3,4,5')]));

    expect(result.status).toBe('done');
  });

  it('fails too little coverage with the uncovered lines, and the retry gets them', async () => {
    const calls: StepContext[] = [];
    const result = await processFile(await job([characterize('1', calls)]));

    expect(result.status).toBe('done');
    expect(calls[1]?.previousFailure).toContain(
      'line coverage of src/Card.jsx is 20% (minimum 80%); uncovered lines: 2–5',
    );
  });

  it('measures the renamed file, and allows renaming protected tests', async () => {
    const j = await job([
      characterize('1,2,3,4,5'),
      later(async (cwd) => {
        await rename(join(cwd, 'src/Card.jsx'), join(cwd, 'src/Card.tsx'));
        await rename(
          join(cwd, 'src/Card.characterization.test.jsx'),
          join(cwd, 'src/Card.characterization.test.tsx'),
        );
      }),
    ]);
    const result = await processFile(j);

    expect(result.status).toBe('done');
    expect((await readFile(j.log, 'utf8')).trim().split('\n')).toEqual([
      'src/Card.jsx',
      'src/Card.tsx',
    ]);
  });

  it('measures nothing when coverage is off', async () => {
    const j = await job([characterize('1')], { coverageMin: 0 });

    expect((await processFile(j)).status).toBe('done');
    expect(await readFile(j.log, 'utf8')).toBe('');
  });

  it.each([
    [
      'a dropped assertion',
      (cwd: string) =>
        writeFile(
          join(cwd, 'src/Card.characterization.test.jsx'),
          TESTS.replace(' expect(2).toBe(2);', ''),
        ),
      'assertions dropped from 3 to 2',
    ],
    [
      'a skipped test',
      (cwd: string) =>
        writeFile(
          join(cwd, 'src/Card.characterization.test.jsx'),
          TESTS.replace("it('b'", "it.skip('b'"),
        ),
      'tests switched off or focused: it.skip at line 2',
    ],
    [
      'a deleted test file',
      (cwd: string) => rm(join(cwd, 'src/Card.characterization.test.jsx'), { force: true }),
      'protected tests src/Card.characterization.test.jsx were deleted',
    ],
  ])('stops a later step from %s', async (_, change, message) => {
    const result = await processFile(
      await job([characterize('1,2,3,4,5'), later(change)], { coverageMin: 0 }),
    );

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toContain(message);
  });

  it('lets a later step add to protected tests', async () => {
    const result = await processFile(
      await job(
        [
          characterize('1,2,3,4,5'),
          later((cwd) =>
            appendFile(
              join(cwd, 'src/Card.characterization.test.jsx'),
              "it('c', () => expect(4).toBe(4));\n",
            ),
          ),
        ],
        { coverageMin: 0 },
      ),
    );

    expect(result.status).toBe('done');
  });

  it('protects nothing when protectTestsFrom is null', async () => {
    const result = await processFile(
      await job(
        [
          characterize('1,2,3,4,5'),
          later((cwd) => rm(join(cwd, 'src/Card.characterization.test.jsx'), { force: true })),
        ],
        { coverageMin: 0, protectTestsFrom: null },
      ),
    );

    expect(result.status).toBe('done');
  });
});
