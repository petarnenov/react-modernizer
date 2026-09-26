import ts from 'typescript';

export interface Extracted {
  /** Module specifiers written as string literals, in source order, without duplicates. */
  specifiers: string[];
  /** An `import()` or `require()` whose argument is not a string literal, so it cannot be followed. */
  hasDynamicImport: boolean;
}

function literalText(node: ts.Node | undefined): string | undefined {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** The imports of one parsed file: `import`, `export … from`, `import()` and `require()`. */
export function extractImports(sourceFile: ts.SourceFile): Extracted {
  const specifiers = new Set<string>();
  let hasDynamicImport = false;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const text = literalText(node.moduleSpecifier);
      if (text !== undefined) {
        specifiers.add(text);
      }
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isImport || isRequire) && node.arguments.length > 0) {
        const text = literalText(node.arguments[0]);
        if (text === undefined) {
          hasDynamicImport = true;
        } else {
          specifiers.add(text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { specifiers: [...specifiers], hasDynamicImport };
}

/** Parses source text on its own; for tests and single files. JSX is accepted in `.js` as in CRA. */
export function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.ts')) return ts.ScriptKind.TS;
  // CRA allows JSX in .js files, so every JavaScript file is read as JSX.
  return ts.ScriptKind.JSX;
}

export interface ParsedFile {
  sourceFile: ts.SourceFile;
  /** Syntax errors, formatted `line:column message`; empty when the file parsed cleanly. */
  syntaxErrors: string[];
}

/**
 * Parses many files at once. A program without resolution or type checking parses each file exactly once and
 * exposes syntax errors through public API.
 */
export function parseFiles(absolutePaths: readonly string[]): Map<string, ParsedFile> {
  const options: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    types: [],
    target: ts.ScriptTarget.Latest,
  };
  const host = ts.createCompilerHost(options, true);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const text = host.readFile(fileName);
    return text === undefined
      ? readSource(fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, text, languageVersion, true, scriptKind(fileName));
  };
  const program = ts.createProgram({ rootNames: absolutePaths, options, host });

  const parsed = new Map<string, ParsedFile>();
  for (const path of absolutePaths) {
    const sourceFile = program.getSourceFile(path);
    if (sourceFile === undefined) {
      continue;
    }
    const syntaxErrors = program.getSyntacticDiagnostics(sourceFile).map((d) => {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
      return `${String(line + 1)}:${String(character + 1)} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
    parsed.set(path, { sourceFile, syntaxErrors });
  }
  return parsed;
}
