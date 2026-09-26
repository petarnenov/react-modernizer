import ts from 'typescript';
import { parseSource } from '../../graph/extract.js';

export type ClassKind = 'component' | 'error-boundary';

export interface ClassComponent {
  /** The class name, or `(anonymous)` for an unnamed class expression. */
  name: string;
  kind: ClassKind;
  line: number;
}

const REACT_BASES = new Set([
  'Component',
  'PureComponent',
  'React.Component',
  'React.PureComponent',
]);

function baseName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return `${expression.expression.text}.${expression.name.text}`;
  }
  return undefined;
}

function isErrorBoundary(node: ts.ClassLikeDeclaration): boolean {
  return node.members.some((member) => {
    const name = member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : '';
    if (name === 'componentDidCatch') return true;
    const isStatic =
      ts.canHaveModifiers(member) &&
      (ts.getModifiers(member) ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
    return name === 'getDerivedStateFromError' && isStatic;
  });
}

/** Classes that extend a React component base, with their kind, from the syntax tree. */
export function findClassComponents(fileName: string, text: string): ClassComponent[] {
  const source = parseSource(fileName, text);
  const found: ClassComponent[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const heritage = node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
      const base =
        heritage?.types[0] === undefined ? undefined : baseName(heritage.types[0].expression);
      if (base !== undefined && REACT_BASES.has(base)) {
        found.push({
          name: node.name?.text ?? '(anonymous)',
          kind: isErrorBoundary(node) ? 'error-boundary' : 'component',
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Names a file exports: `default`, named exports, and `* from '…'` for re-export-alls. */
export function exportedNames(fileName: string, text: string): string[] {
  const source = parseSource(fileName, text);
  const names = new Set<string>();
  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      names.add('default');
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined) {
        const from = statement.moduleSpecifier;
        names.add(`* from '${from !== undefined && ts.isStringLiteral(from) ? from.text : '?'}'`);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      } else {
        names.add(statement.exportClause.name.text); // export * as ns from '…'
      }
    } else if (isExported(statement)) {
      if (isDefault(statement)) {
        names.add('default');
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement)) &&
        statement.name !== undefined
      ) {
        names.add(statement.name.text);
      }
    }
  }
  return [...names].sort();
}

/** What changed between two export lists, or undefined when they are the same. */
export function exportsChanged(
  before: readonly string[],
  after: readonly string[],
): string | undefined {
  const missing = before.filter((n) => !after.includes(n));
  const added = after.filter((n) => !before.includes(n));
  if (missing.length === 0 && added.length === 0) return undefined;
  const parts = [
    missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
    added.length > 0 ? `added: ${added.join(', ')}` : '',
  ].filter((p) => p !== '');
  return `the file's exports changed (${parts.join('; ')}); importers would break — keep the same exports`;
}
