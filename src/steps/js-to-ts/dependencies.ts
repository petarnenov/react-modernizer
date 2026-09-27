import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/** A type error the file cannot fix with types only: another project file's types lack what the file uses. */
export interface DependencyError {
  /** Relative to the target, as the step names it. */
  file: string;
  /** 1-based. */
  line: number;
  message: string;
  /** The project file declaring the symbol whose type lacks the member. */
  declaredIn: string;
}

/**
 * "Does not exist" and "not accepted" errors: a property missing on a type (2339, 2551), an object-literal property
 * the parameter does not declare (2353), an argument count the function does not allow (2554, 2555). A JSX prop the
 * component does not declare is a 2322 whose chain holds a 2339, so the chain is searched too.
 */
const CODES = new Set([2339, 2551, 2353, 2554, 2555]);

function codesOf(chain: string | ts.DiagnosticMessageChain): number[] {
  return typeof chain === 'string'
    ? []
    : [chain.code, ...(chain.next ?? []).flatMap((next) => codesOf(next))];
}

function qualifies(diagnostic: ts.Diagnostic): boolean {
  return [diagnostic.code, ...codesOf(diagnostic.messageText)].some((c) => CODES.has(c));
}

/** The deepest node that contains `position`. */
function nodeAt(sourceFile: ts.SourceFile, position: number): ts.Node {
  let found: ts.Node = sourceFile;
  const visit = (node: ts.Node): void => {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * What the error is about: the value whose property is accessed, the JSX component, or the function called —
 * whichever encloses the error first. Undefined when none does before the enclosing function or block.
 */
function anchorOf(node: ts.Node): ts.Node | undefined {
  let previous: ts.Node | undefined;
  // `parent` is typed non-optional; the walk ends at the source file at the latest.
  for (let current = node; ; current = current.parent) {
    if (ts.isPropertyAccessExpression(current) && previous === current.name) {
      return current.expression;
    }
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      return current.tagName;
    }
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      return current.expression;
    }
    if (ts.isFunctionLike(current) || ts.isBlock(current) || ts.isSourceFile(current)) {
      return undefined;
    }
    previous = current;
  }
}

function symbolOf(checker: ts.TypeChecker, anchor: ts.Node): ts.Symbol | undefined {
  const at = ts.isPropertyAccessExpression(anchor) ? anchor.name : anchor;
  const symbol = checker.getSymbolAtLocation(at);
  if (symbol === undefined) return undefined;
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

const posix = (path: string): string => path.split(sep).join('/');

const MOCK_CALLS = new Set(['mock', 'doMock']);

/** The files `sourceFile` replaces with `jest.mock(…)` / `jest.doMock(…)`, resolved as its imports are. */
function mockedModules(sourceFile: ts.SourceFile, options: ts.CompilerOptions): Set<string> {
  const mocked = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'jest' &&
      MOCK_CALLS.has(node.expression.name.text)
    ) {
      const [specifier] = node.arguments;
      const resolved =
        specifier !== undefined && ts.isStringLiteralLike(specifier)
          ? resolveModule(specifier.text, sourceFile.fileName, options)
          : undefined;
      if (resolved !== undefined) mocked.add(resolved);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return mocked;
}

function resolveModule(
  specifier: string,
  containingFile: string,
  options: ts.CompilerOptions,
): string | undefined {
  return ts.resolveModuleName(specifier, containingFile, options, ts.sys).resolvedModule
    ?.resolvedFileName;
}

/**
 * The module an identifier was imported from, when `anchor` is one — default, named or namespace import — resolved
 * like any import.
 */
function importedFrom(
  checker: ts.TypeChecker,
  anchor: ts.Node,
  options: ts.CompilerOptions,
): string | undefined {
  const at = ts.isPropertyAccessExpression(anchor) ? anchor.name : anchor;
  const local = checker.getSymbolAtLocation(at);
  const declaration = local?.declarations?.[0];
  if (declaration === undefined) return undefined;
  const importDeclaration = ts.findAncestor(declaration, ts.isImportDeclaration);
  if (importDeclaration === undefined || !ts.isStringLiteral(importDeclaration.moduleSpecifier)) {
    return undefined;
  }
  return resolveModule(
    importDeclaration.moduleSpecifier.text,
    declaration.getSourceFile().fileName,
    options,
  );
}

/**
 * Type-checks `files` (relative to `cwd`, already renamed, unchanged) with the target's `tsconfig.json` and returns
 * the errors on symbols declared in other project files — not in `files`, TypeScript's libraries or packages, and not
 * imported from a module the same file mocks. Without a `tsconfig.json` at the target root there is nothing to check
 * against.
 */
export function missingOnDependencies(cwd: string, files: readonly string[]): DependencyError[] {
  const configPath = join(cwd, 'tsconfig.json');
  if (!existsSync(configPath)) return [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (parsed === undefined) return [];

  const own = files.map((f) => join(cwd, f));
  // Global declarations (`src/typings/*.d.ts`) without parsing the whole project; imports are followed as usual.
  const declarations = parsed.fileNames.filter((f) => f.endsWith('.d.ts'));
  const program = ts.createProgram({
    rootNames: [...own, ...declarations],
    options: { ...parsed.options, noEmit: true },
  });
  const checker = program.getTypeChecker();
  const ownFiles = new Set(own.map((f) => program.getSourceFile(f)).filter((s) => s !== undefined));
  const isDependency = (sourceFile: ts.SourceFile): boolean =>
    !ownFiles.has(sourceFile) &&
    !program.isSourceFileDefaultLibrary(sourceFile) &&
    !program.isSourceFileFromExternalLibrary(sourceFile);

  const found: DependencyError[] = [];
  for (const [index, path] of own.entries()) {
    const sourceFile = program.getSourceFile(path);
    if (sourceFile === undefined) continue;
    // A mocked module's exports are mocks at runtime: a type assertion in this file fixes what their types lack.
    const mocked = mockedModules(sourceFile, parsed.options);
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
      if (diagnostic.start === undefined || !qualifies(diagnostic)) continue;
      const anchor = anchorOf(nodeAt(sourceFile, diagnostic.start));
      if (anchor === undefined) continue;
      const from = importedFrom(checker, anchor, parsed.options);
      if (from !== undefined && mocked.has(from)) continue;
      const symbol = symbolOf(checker, anchor);
      const declared = (symbol?.declarations ?? []).map((d) => d.getSourceFile());
      if (declared.length === 0 || !declared.every(isDependency)) continue;
      const first = declared[0];
      if (first === undefined) continue;
      found.push({
        file: files[index] ?? posix(relative(cwd, path)),
        line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        declaredIn: posix(relative(cwd, first.fileName)),
      });
    }
  }
  return found;
}

/** The step's failure for a file blocked by its dependencies' types. */
export function describeMissing(errors: readonly DependencyError[]): string {
  const lines = errors.map(
    (e) => `${e.file}:${String(e.line)} ${e.message} (declared in ${e.declaredIn})`,
  );
  const first = [...new Set(errors.map((e) => e.declaredIn))].sort();
  return (
    'type errors on symbols whose declared types lack what this file uses; no types-only change here can fix them:\n' +
    `${lines.join('\n')}\n` +
    `type these first: ${first.join(', ')}`
  );
}
