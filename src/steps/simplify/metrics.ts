import ts from 'typescript';
import { parseSource } from '../../graph/extract.js';
import { normalize } from '../shared/normalize.js';

export interface Measures {
  /** Non-empty lines of the normalised code: comments and formatting do not count. */
  lines: number;
  /** Decision points plus the deepest nesting of blocks and expression-bodied arrows. */
  complexity: number;
}

const BRANCHING_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function isBranch(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isCaseClause(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCatchClause(node) ||
    (ts.isBinaryExpression(node) && BRANCHING_OPERATORS.has(node.operatorToken.kind))
  );
}

function opensScope(node: ts.Node): boolean {
  return ts.isBlock(node) || (ts.isArrowFunction(node) && !ts.isBlock(node.body));
}

/** Code size and complexity of a file, from its syntax tree. */
export function measure(fileName: string, text: string): Measures {
  const lines = normalize(fileName, text)
    .split('\n')
    .filter((l) => l.trim() !== '').length;
  let branches = 0;
  let deepest = 0;
  const visit = (node: ts.Node, depth: number): void => {
    if (isBranch(node)) branches++;
    const inner = opensScope(node) ? depth + 1 : depth;
    deepest = Math.max(deepest, inner);
    ts.forEachChild(node, (child) => {
      visit(child, inner);
    });
  };
  visit(parseSource(fileName, text), 0);
  return { lines, complexity: branches + deepest };
}

/**
 * Why `after` is not simpler than `before`, or undefined when it is: neither measure may grow, and one must shrink.
 * An unchanged file is the caller's to accept before asking.
 */
export function notSimpler(before: Measures, after: Measures): string | undefined {
  const worse = after.lines > before.lines || after.complexity > before.complexity;
  const better = after.lines < before.lines || after.complexity < before.complexity;
  if (!worse && better) return undefined;
  return (
    `not simpler: ${String(before.lines)} → ${String(after.lines)} code lines, complexity ` +
    `${String(before.complexity)} → ${String(after.complexity)}. Neither may grow and one must shrink; ` +
    'if that is not possible, leave the file unchanged.'
  );
}
