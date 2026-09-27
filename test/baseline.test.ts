import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.js';
import {
  countErrors,
  newErrors,
  parseErrors,
  totalErrors,
  type ReportedError,
} from '../src/run/baseline.js';
import { expandCommand, judge, runCommand } from '../src/run/gates.js';
import { runModernizer } from '../src/run/runner.js';
import type { ProgressEvent } from '../src/run/progress.js';
import type { Step } from '../src/steps/step.js';
import { sh, tempRepo } from './helpers/repo.js';

const TSC = [
  "src/a.ts(3,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
  "src/a.ts(9,1): error TS2322: Type '{}' is missing the following properties:",
  '  x, y',
  "src/b.ts(1,1): error TS2578: Unused '@ts-expect-error' directive.",
  'Found 3 errors in 2 files.',
].join('\n');

describe('parseErrors', () => {
  it('reads tsc errors with their continuation lines', () => {
    const errors = parseErrors('tsc', TSC, ['/w']);

    expect(errors.map((e) => [e.file, e.what])).toEqual([
      [
        'src/a.ts',
        "TS2345 Argument of type 'string' is not assignable to parameter of type 'number'.",
      ],
      ['src/a.ts', "TS2322 Type '{}' is missing the following properties:\nx, y"],
      ['src/b.ts', "TS2578 Unused '@ts-expect-error' directive."],
    ]);
  });

  it('reads ESLint JSON errors, makes absolute paths relative, and skips warnings', () => {
    const output = [
      'npm warn exec something',
      JSON.stringify([
        {
          filePath: '/w/src/a.js',
          messages: [
            {
              ruleId: 'no-unused-vars',
              severity: 2,
              message: "'x' is assigned a value but never used.",
              line: 4,
              column: 7,
            },
            {
              ruleId: 'no-console',
              severity: 1,
              message: 'Unexpected console statement.',
              line: 9,
              column: 1,
            },
          ],
        },
      ]),
    ].join('\n');

    expect(parseErrors('eslint', output, ['/elsewhere', '/w'])).toEqual([
      {
        file: 'src/a.js',
        what: "no-unused-vars 'x' is assigned a value but never used.",
        text: "src/a.js:4:7: 'x' is assigned a value but never used. [no-unused-vars]",
      },
    ]);
    expect(parseErrors('eslint', 'Oops! Something went wrong!', [])).toEqual([]);
  });
});

const err = (file: string, what: string, line = 1): ReportedError => ({
  file,
  what,
  text: `${file}(${String(line)},1): error ${what}`,
});

const ESC = String.fromCharCode(27);
const JEST = [
  'PASS src/ok.test.js',
  '  ● Console',
  '',
  '    console.log',
  '      hello',
  '',
  `${ESC}[1m${ESC}[31mFAIL${ESC}[39m${ESC}[22m src/Fields.test.tsx (66.186 s)`,
  '  ● Fields › sets a negative default',
  '',
  '    Unable to find an element with the text: must fall between 0 and 100',
  '',
  ...Array.from({ length: 20 }, (_, i) => `      <div id="${String(i)}" />`),
  '',
  '  ● Fields › sets a negative min',
  '',
  '    expect(received).toBe(expected)',
  '',
  'FAIL /w/src/broken.test.js',
  '  ● Test suite failed to run',
  '',
  "    Cannot find module './gone'",
  '',
  'Summary of all failing tests',
  'FAIL src/Fields.test.tsx',
  '  ● Fields › sets a negative default',
  '',
  'Tests:       3 failed, 1 passed, 4 total',
].join('\n');

describe('parseErrors jest', () => {
  it('reads failing tests by test file and title, not console blocks or the repeated summary', () => {
    const errors = parseErrors('jest', JEST, ['/w']);

    expect(errors.map((e) => [e.file, e.what])).toEqual([
      ['src/Fields.test.tsx', 'Fields › sets a negative default'],
      ['src/Fields.test.tsx', 'Fields › sets a negative min'],
      ['src/broken.test.js', 'Test suite failed to run'],
    ]);
  });

  it('keeps the start of each message for the model', () => {
    const [first, second] = parseErrors('jest', JEST, ['/w']);

    expect(first?.text).toContain('Unable to find an element');
    expect(first?.text.split('\n')).toHaveLength(13);
    expect(second?.text).toBe(
      'src/Fields.test.tsx › Fields › sets a negative min\n    expect(received).toBe(expected)',
    );
  });

  it('passes tests that already failed and fails a newly failing one', () => {
    const command = { run: 'jest', newErrorsOnly: 'jest' as const };
    const baseline = countErrors(parseErrors('jest', JEST, ['/w']));
    const added = [
      'FAIL src/Card.test.js',
      '  ● Card › formats 1000',
      '',
      '    expected 1,000',
    ].join('\n');

    expect(judge(command, { ok: false, output: JEST }, ['/w'], baseline)).toEqual({ ok: true });
    const result = judge(command, { ok: false, output: `${added}\n${JEST}` }, ['/w'], baseline);
    expect(result).toEqual({
      ok: false,
      gate: 'jest',
      output:
        '1 new error(s); errors that were there before are not shown:\n' +
        'src/Card.test.js › Card › formats 1000\n    expected 1,000',
    });
  });
});

describe('newErrors', () => {
  const baseline = countErrors([err('src/a.ts', 'TS1 old'), err('src/a.ts', 'TS1 old')]);

  it('is empty when only legacy errors remain, even on other lines', () => {
    expect(
      newErrors([err('src/a.ts', 'TS1 old', 40), err('src/a.ts', 'TS1 old', 50)], baseline),
    ).toEqual([]);
  });

  it('counts: a third identical error is new', () => {
    const third = err('src/a.ts', 'TS1 old', 60);
    expect(
      newErrors([err('src/a.ts', 'TS1 old'), err('src/a.ts', 'TS1 old'), third], baseline),
    ).toEqual([third]);
  });

  it('matches a renamed file with its old name', () => {
    expect(
      newErrors([err('src/a.tsx', 'TS1 old')], baseline, (f) =>
        f === 'src/a.tsx' ? 'src/a.ts' : f,
      ),
    ).toEqual([]);
    expect(newErrors([err('src/a.tsx', 'TS1 old')], baseline)).toHaveLength(1);
  });

  it('totals the counts', () => {
    expect(totalErrors(baseline)).toBe(2);
  });
});

describe('judge', () => {
  const command = { run: 'npx tsc --noEmit', newErrorsOnly: 'tsc' as const };
  const baseline = countErrors(parseErrors('tsc', TSC, []));

  it('passes a failing type check that reports only legacy errors', () => {
    expect(judge(command, { ok: false, output: TSC }, [], baseline)).toEqual({ ok: true });
  });

  it('fails on a new error and shows only that one', () => {
    const added = "src/c.ts(2,2): error TS7006: Parameter 'x' implicitly has an 'any' type.";
    const result = judge(command, { ok: false, output: `${TSC}\n${added}` }, [], baseline);

    expect(result).toEqual({
      ok: false,
      gate: 'npx tsc --noEmit',
      output: `1 new error(s); errors that were there before are not shown:\n${added}`,
    });
  });

  it('fails a crash that reports no errors in the format', () => {
    expect(judge(command, { ok: false, output: 'Segmentation fault' }, [], baseline)).toMatchObject(
      {
        ok: false,
        output: 'Segmentation fault',
      },
    );
  });

  it('judges plain commands by exit code', () => {
    expect(judge({ run: 'true' }, { ok: true, output: '' }, [], undefined)).toEqual({ ok: true });
  });
});

describe('command output', () => {
  it('keeps the whole output when it is parsed, and a tail otherwise', async () => {
    const big = 'node -e "for (let i = 0; i < 5000; i++) console.log(\'line \' + i)"';

    const full = await runCommand(big, process.cwd(), 30, { full: true });
    const tail = await runCommand(big, process.cwd(), 30);

    expect(full.output.split('\n')[0]).toBe('line 0');
    expect(tail.output.length).toBeLessThanOrEqual(20_001);
    expect(tail.output).not.toContain('line 0\n');
  });

  it('replaces {cache} with the quoted cache directory', () => {
    expect(expandCommand('tsc --tsBuildInfoFile {cache}/x {files}', ['a b.ts'], "/t/it's")).toBe(
      "tsc --tsBuildInfoFile '/t/it'\\''s'/x 'a b.ts'",
    );
  });
});

/** A tsc stand-in: one TS error per line containing BROKEN in any src file. */
const FAKE_TSC =
  "grep -rn BROKEN src | sed -E 's/^([^:]+):([0-9]+):.*/\\1(\\2,1): error TS1000: broken/'; ! grep -rq BROKEN src";
/** An ESLint stand-in printing JSON with absolute paths: one error per line containing BROKEN in the given files. */
const FAKE_ESLINT =
  "node -e \"const fs=require('fs');console.log(JSON.stringify(process.argv.slice(1).map(f=>({filePath:process.cwd()+'/'+f,messages:fs.readFileSync(f,'utf8').split('\\\\n').flatMap((l,i)=>l.includes('BROKEN')?[{ruleId:'no-broken',severity:2,message:'broken',line:i+1,column:1}]:[])}))))\" {files}; ! grep -q BROKEN {files}";

/** A Jest stand-in: a legacy test always fails; `src/Card.test.js` fails when a file it covers contains BROKEN. */
const FAKE_JEST =
  "printf 'FAIL src/legacy.test.js\\n  ● legacy › fails\\n\\n    expected 1\\n'; " +
  "if grep -qs BROKEN {files}; then printf 'FAIL src/Card.test.js\\n  ● Card › works\\n\\n    expected 2\\n'; fi; exit 1";

function project(root: string, commands: unknown[]) {
  return parseConfig({
    target: root,
    steps: {
      analyze: { enabled: false },
      'characterize-tests': { enabled: false },
      'class-to-function': { enabled: false },
      'js-to-ts': { enabled: false },
    },
    gates: { commands, coverage: { min: 0 } },
    retry: { perStep: 1 },
  });
}

const writing = (text: (n: number) => string, file = 'src/Card.js'): Step => {
  let n = 0;
  return {
    id: 'simplify',
    run: async (ctx) => {
      n++;
      await writeFile(join(ctx.cwd, file), text(n));
    },
  };
};

describe('a run with baseline gates', () => {
  it('passes despite legacy errors elsewhere, and reports the baseline', async () => {
    const root = await tempRepo({
      'src/legacy.js': 'BROKEN\nBROKEN\n',
      'src/Card.js': 'export const a = 1;\n',
    });
    const events: ProgressEvent[] = [];
    const config = project(root, [{ run: FAKE_TSC, newErrorsOnly: 'tsc' }]);

    const summary = await runModernizer({
      config: { ...config, source: { include: ['src/Card.js'], exclude: [] } },
      steps: { simplify: writing(() => 'export const a = 2;\n') },
      log: () => undefined,
      progress: (e) => events.push(e),
    });

    expect(summary).toMatchObject({ done: 1, failed: 0 });
    expect(events.filter((e) => e.kind === 'phase').map((e) => e.text)).toContain(
      `baseline: ${FAKE_TSC} — 2 errors already there`,
    );
  });

  it('fails on a new error and gives the step only that error', async () => {
    const root = await tempRepo({
      'src/legacy.js': 'BROKEN\n',
      'src/Card.js': 'export const a = 1;\n',
    });
    const seen: (string | undefined)[] = [];
    const step: Step = {
      id: 'simplify',
      run: async (ctx) => {
        seen.push(ctx.previousFailure);
        await writeFile(join(ctx.cwd, 'src/Card.js'), 'export const a = 2; // BROKEN\n');
      },
    };

    const summary = await runModernizer({
      config: {
        ...project(root, [{ run: FAKE_TSC, newErrorsOnly: 'tsc' }]),
        source: { include: ['src/Card.js'], exclude: [] },
      },
      steps: { simplify: step },
      log: () => undefined,
    });

    expect(summary.failed).toBe(1);
    expect(seen[1]).toContain('1 new error(s)');
    expect(seen[1]).toContain('src/Card.js(1,1): error TS1000: broken');
    expect(seen[1]).not.toContain('legacy');
  });

  it('takes a per-file baseline for {files} commands, following a rename', async () => {
    const root = await tempRepo({ 'src/Card.js': 'BROKEN\nexport const a = 1;\n' });
    const step: Step = {
      id: 'simplify',
      run: async (ctx) => {
        sh(ctx.cwd, 'mv', 'src/Card.js', 'src/Card.ts');
        await writeFile(join(ctx.cwd, 'src/Card.ts'), 'BROKEN\nexport const a = 1;\n');
      },
    };

    const summary = await runModernizer({
      config: project(root, [{ run: FAKE_ESLINT, newErrorsOnly: 'eslint' }]),
      steps: { simplify: step },
      log: () => undefined,
    });

    expect(summary).toMatchObject({ done: 1, failed: 0 });
  });
});

describe('a run with a jest baseline gate', () => {
  it('passes despite a test that failed before the step, following a rename', async () => {
    const root = await tempRepo({ 'src/Card.js': 'export const a = 1;\n' });
    const step: Step = {
      id: 'simplify',
      run: async (ctx) => {
        sh(ctx.cwd, 'mv', 'src/Card.js', 'src/Card.ts');
        await writeFile(join(ctx.cwd, 'src/Card.ts'), 'export const a = 2;\n');
      },
    };

    const summary = await runModernizer({
      config: project(root, [{ run: FAKE_JEST, newErrorsOnly: 'jest' }]),
      steps: { simplify: step },
      log: () => undefined,
    });

    expect(summary).toMatchObject({ done: 1, failed: 0 });
  });

  it('fails on a newly failing test and gives the step only that one', async () => {
    const root = await tempRepo({ 'src/Card.js': 'export const a = 1;\n' });
    const seen: (string | undefined)[] = [];
    let n = 0;
    const step: Step = {
      id: 'simplify',
      run: async (ctx) => {
        seen.push(ctx.previousFailure);
        n++;
        await writeFile(join(ctx.cwd, 'src/Card.js'), `export const a = ${String(n)}; // BROKEN\n`);
      },
    };

    const summary = await runModernizer({
      config: project(root, [{ run: FAKE_JEST, newErrorsOnly: 'jest' }]),
      steps: { simplify: step },
      log: () => undefined,
    });

    expect(summary.failed).toBe(1);
    expect(seen[1]).toContain('src/Card.test.js › Card › works\n    expected 2');
    expect(seen[1]).not.toContain('src/legacy.test.js ›');
  });
});

describe('gates leave nothing behind', () => {
  it('removes what a gate wrote, so it is neither a step change nor committed', async () => {
    const root = await tempRepo({ 'src/Card.js': 'export const a = 1;\n' });
    let attempts = 0;
    const step = writing((n) => {
      attempts = n;
      return `export const a = ${String(n + 1)};\n`;
    });
    // Fails the first time and always leaves build info behind, as tsc --incremental does.
    const gate = 'touch tsconfig.tsbuildinfo; grep -q "a = 3" src/Card.js';
    const config = parseConfig({
      ...project(root, [{ run: gate }]),
      retry: { perStep: 2 },
    });

    const summary = await runModernizer({
      config,
      steps: { simplify: step },
      log: () => undefined,
    });

    expect(summary).toMatchObject({ done: 1, failed: 0 });
    expect(attempts).toBe(2);
    expect(sh(root, 'ls-tree', '-r', '--name-only', 'main-modernized')).not.toContain(
      'tsbuildinfo',
    );
  });

  it('keeps {cache} outside the worktree across files and runs', async () => {
    const root = await tempRepo({ 'src/a.js': 'export const a = 1;\n' });
    const caches: string[] = [];
    const step: Step = {
      id: 'simplify',
      run: async (ctx) => {
        caches.push(ctx.cache ?? '');
        await writeFile(join(ctx.cwd, 'src/a.js'), 'export const a = 2;\n');
      },
    };
    const config = project(root, [{ run: 'echo warm >> {cache}/state' }]);

    await runModernizer({ config, steps: { simplify: step }, log: () => undefined });

    const cache = caches[0] ?? '';
    expect(cache).not.toContain('.git');
    expect(cache.startsWith(root)).toBe(false);
    expect((await stat(cache)).isDirectory()).toBe(true);
    expect(await readFile(join(cache, 'state'), 'utf8')).toBe('warm\n');
  });
});
