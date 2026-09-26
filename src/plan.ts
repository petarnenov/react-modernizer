import type { ImportGraph } from './graph/build.js';
import type { ImportKind } from './graph/resolve.js';
import { Scheduler } from './orchestrator/scheduler.js';

export interface Plan {
  target: string;
  /** The order the scheduler hands files out in when every file succeeds. */
  order: string[];
  stats: {
    files: number;
    edges: number;
    /** Files that import no processed file. */
    leaves: number;
    imports: Record<ImportKind, number>;
  };
  unresolved: { file: string; specifier: string }[];
  dynamic: string[];
  parseErrors: { file: string; errors: string[] }[];
  cycles: string[][];
}

/** The processing order comes from the real scheduler, so the plan cannot drift from what a run does. */
function drain(graph: ImportGraph): string[] {
  const scheduler = new Scheduler(graph.edges);
  const order: string[] = [];
  for (let file = scheduler.next(); file !== undefined; file = scheduler.next()) {
    order.push(file);
    scheduler.complete(file, 'done');
  }
  return order;
}

export function createPlan(target: string, graph: ImportGraph): Plan {
  const imports: Record<ImportKind, number> = {
    internal: 0,
    outside: 0,
    asset: 0,
    package: 0,
    unresolved: 0,
  };
  const unresolved: Plan['unresolved'] = [];
  for (const [file, list] of graph.imports) {
    for (const i of list) {
      imports[i.kind]++;
      if (i.kind === 'unresolved') {
        unresolved.push({ file, specifier: i.specifier });
      }
    }
  }
  const deps = [...graph.edges.values()];

  return {
    target,
    order: drain(graph),
    stats: {
      files: graph.files.length,
      edges: deps.reduce((sum, d) => sum + d.length, 0),
      leaves: deps.filter((d) => d.length === 0).length,
      imports,
    },
    unresolved,
    dynamic: graph.dynamic,
    parseErrors: [...graph.parseErrors].map(([file, errors]) => ({ file, errors })),
    cycles: graph.cycles,
  };
}

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : ['', `${title} (${String(lines.length)}):`, ...lines];
}

export function renderPlan(plan: Plan): string {
  const { stats } = plan;
  const width = String(plan.order.length).length;
  return [
    `Target: ${plan.target}`,
    `Files: ${String(stats.files)} · edges: ${String(stats.edges)} · leaves: ${String(stats.leaves)} · cycles: ${String(plan.cycles.length)}`,
    `Imports: ${Object.entries(stats.imports)
      .map(([kind, n]) => `${kind} ${String(n)}`)
      .join(' · ')}`,
    ...section(
      'Order',
      plan.order.map((file, i) => `  ${String(i + 1).padStart(width)}  ${file}`),
    ),
    ...section(
      'Unresolved imports',
      plan.unresolved.map((u) => `  ${u.file}  ${u.specifier}`),
    ),
    ...section(
      'Dynamic imports that cannot be followed',
      plan.dynamic.map((file) => `  ${file}`),
    ),
    ...section(
      'Could not be parsed',
      plan.parseErrors.map((p) => `  ${p.file}  ${p.errors.join('; ')}`),
    ),
    ...section(
      'Cycles',
      plan.cycles.map((c) => `  ${c.join(' → ')}`),
    ),
    '',
  ].join('\n');
}
