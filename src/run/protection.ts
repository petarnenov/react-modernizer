import ts from 'typescript';
import { parseSource } from '../graph/extract.js';

export interface TestCounts {
  /** `it(…)`, `test(…)` and `it.each(…)(…)` calls, disabled ones included. */
  cases: number;
  /** `expect(…)` calls. */
  assertions: number;
  /** Tests switched off or focused: `.skip`, `.only`, `.todo`, `xit`, `fit`, …, with their line. */
  disabled: string[];
}

const CASE = /^(it|test|xit|xtest|fit)(\.(only|skip|concurrent|failing))*(\.each\(\))?$/;
const DISABLED =
  /^((it|test|describe)\.(skip|only|todo)|xit|xtest|xdescribe|fit|fdescribe)(\.|\(|$)/;

/** `it.skip.each(table)` → `it.skip.each()`; anything not a plain name chain → undefined. */
function calleeName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const object = calleeName(node.expression);
    return object === undefined ? undefined : `${object}.${node.name.text}`;
  }
  if (ts.isCallExpression(node)) {
    const inner = calleeName(node.expression);
    return inner === undefined ? undefined : `${inner}()`;
  }
  return undefined;
}

/** Counts from the syntax tree, so comments and strings never count. */
export function countTests(fileName: string, text: string): TestCounts {
  const source = parseSource(fileName, text);
  const counts: TestCounts = { cases: 0, assertions: 0, disabled: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name !== undefined) {
        if (name === 'expect') counts.assertions++;
        if (CASE.test(name)) counts.cases++;
        // `it.skip.each(table)(…)`: the inner call carries the marker; count it once, there.
        if (DISABLED.test(name) && !name.endsWith('()')) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          counts.disabled.push(`${name} at line ${String(line)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return counts;
}

/** Why `after` weakens the tests recorded as `before`, or undefined when it does not. */
export function weakening(path: string, before: TestCounts, after: TestCounts): string | undefined {
  const problems: string[] = [];
  if (after.cases < before.cases) {
    problems.push(`test cases dropped from ${String(before.cases)} to ${String(after.cases)}`);
  }
  if (after.assertions < before.assertions) {
    problems.push(
      `assertions dropped from ${String(before.assertions)} to ${String(after.assertions)}`,
    );
  }
  if (after.disabled.length > before.disabled.length) {
    problems.push(`tests switched off or focused: ${after.disabled.join(', ')}`);
  }
  return problems.length === 0
    ? undefined
    : `protected tests ${path} weakened: ${problems.join('; ')}`;
}
