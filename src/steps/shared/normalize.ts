import ts from 'typescript';
import { parseSource } from '../../graph/extract.js';

// One printer everywhere: formatting and comments never make a difference.
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/**
 * The printer reproduces line breaks and trailing commas it finds in the source positions. Dropping every node's
 * position leaves it nothing to reproduce: blocks and object literals come out one member per line, everything else
 * in the printer's own layout, whatever the input looked like.
 */
const withoutPositions: ts.TransformerFactory<ts.SourceFile> = (context) => {
  // Every list rebuilt: no source positions (no preserved line breaks) and no trailing comma.
  const lists = ((
    nodes: ts.NodeArray<ts.Node> | undefined,
    visitor: ts.Visitor | undefined,
    test?: (node: ts.Node) => boolean,
    start?: number,
    count?: number,
  ): ts.NodeArray<ts.Node> | undefined => {
    const visited =
      visitor === undefined ? nodes : ts.visitNodes(nodes, visitor, test, start, count);
    return visited === undefined ? undefined : ts.factory.createNodeArray([...visited], false);
  }) as ts.NodesVisitor;
  const visit = (node: ts.Node): ts.Node => {
    // Never undefined for a node that exists; the overload with a nodes visitor just cannot say so.
    const visited = ts.visitEachChild(node, visit, context, lists) as ts.Node;
    if (ts.isBlock(visited)) {
      return ts.factory.createBlock(visited.statements, true);
    }
    if (ts.isObjectLiteralExpression(visited)) {
      return ts.factory.createObjectLiteralExpression(visited.properties, true);
    }
    if (ts.isArrayLiteralExpression(visited)) {
      return ts.factory.createArrayLiteralExpression(visited.elements, false);
    }
    return ts.setTextRange(visited, { pos: -1, end: -1 });
  };
  return (file: ts.SourceFile): ts.SourceFile =>
    ts.visitEachChild(file, visit, context, lists) as ts.SourceFile;
};

/** The code as the TypeScript printer writes it, without comments: the same text for the same program. */
export function normalize(fileName: string, text: string): string {
  const source = parseSource(fileName, text);
  const result = ts.transform(source, [withoutPositions]);
  try {
    const [transformed] = result.transformed;
    return printer.printFile(transformed ?? source);
  } finally {
    result.dispose();
  }
}
