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

export interface ExportedName {
  name: string;
  /** Types and interfaces are erased at runtime; adding one breaks no importer. */
  kind: 'value' | 'type';
}

/** What a file exports: `default`, named exports, and `* from '…'` for re-export-alls, each a value or a type. */
export function exports(fileName: string, text: string): ExportedName[] {
  const source = parseSource(fileName, text);
  const found = new Map<string, ExportedName['kind']>();
  const add = (name: string, kind: ExportedName['kind']): void => {
    if (found.get(name) !== 'value') found.set(name, kind);
  };
  const modifiers = (node: ts.Node): readonly ts.ModifierLike[] =>
    ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  const has = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    modifiers(node).some((m) => m.kind === kind);

  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      add('default', 'value');
    } else if (ts.isExportDeclaration(statement)) {
      const kind = statement.isTypeOnly ? 'type' : 'value';
      if (statement.exportClause === undefined) {
        const from = statement.moduleSpecifier;
        add(`* from '${from !== undefined && ts.isStringLiteral(from) ? from.text : '?'}'`, kind);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          add(element.name.text, element.isTypeOnly ? 'type' : kind);
        }
      } else {
        add(statement.exportClause.name.text, kind); // export * as ns from '…'
      }
    } else if (has(statement, ts.SyntaxKind.ExportKeyword)) {
      const typeOnly = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
      if (has(statement, ts.SyntaxKind.DefaultKeyword)) {
        add('default', typeOnly ? 'type' : 'value');
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) add(declaration.name.text, 'value');
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement)) &&
        statement.name !== undefined
      ) {
        add(statement.name.text, typeOnly ? 'type' : 'value');
      }
    }
  }
  return [...found]
    .map(([name, kind]) => ({ name, kind }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Every exported name, values and types alike, sorted. */
export function exportedNames(fileName: string, text: string): string[] {
  return exports(fileName, text).map((e) => e.name);
}

/** Only the names that exist at runtime — what importers actually depend on. */
export function exportedValueNames(fileName: string, text: string): string[] {
  return exports(fileName, text)
    .filter((e) => e.kind === 'value')
    .map((e) => e.name);
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
