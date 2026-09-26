/**
 * Groups of files that import each other, directly or indirectly: strongly connected components of two or more
 * files (Tarjan). Iterative, so a long import chain cannot overflow the stack. Each group and the list of groups are
 * sorted.
 */
export function findCycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  for (const root of edges.keys()) {
    if (index.has(root)) continue;

    // Each frame is a node and how far through its imports the walk has got.
    const frames: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    lowLink.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      const imports = edges.get(frame.node) ?? [];

      if (frame.next < imports.length) {
        const dep = imports[frame.next++];
        if (dep === undefined || !edges.has(dep)) continue;
        if (!index.has(dep)) {
          index.set(dep, counter);
          lowLink.set(dep, counter);
          counter++;
          stack.push(dep);
          onStack.add(dep);
          frames.push({ node: dep, next: 0 });
        } else if (onStack.has(dep)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node) ?? 0, index.get(dep) ?? 0));
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        lowLink.set(
          parent.node,
          Math.min(lowLink.get(parent.node) ?? 0, lowLink.get(frame.node) ?? 0),
        );
      }
      if (lowLink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string | undefined;
        do {
          member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) {
          cycles.push(component.sort(compare));
        }
      }
    }
  }

  return cycles.sort((a, b) => compare(a[0] ?? '', b[0] ?? ''));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
