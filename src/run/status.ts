import type { ModernizerConfig } from '../config/schema.js';
import { buildGraph } from '../graph/build.js';
import { openRepository } from './git.js';
import { statePath } from './runner.js';
import { loadState } from './state.js';
import { runDirectory } from './workspace.js';
import { SEVERITIES, type BugReport, type Severity } from '../steps/step.js';

const RANKS: readonly Severity[] = SEVERITIES;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A text summary of the saved run state: counts, tokens, reported bugs, and every failed file with its reason. */
export async function describeStatus(config: ModernizerConfig): Promise<string> {
  const graph = await buildGraph(config.target, config.source);
  const repo = await openRepository(config.target);
  const state = await loadState(statePath(runDirectory(repo, config.git.branch)));
  const records = graph.files.map((file) => [file, state?.files[file]] as const);
  const failed = records.filter(([, r]) => r?.status === 'failed');
  const done = records.filter(([, r]) => r?.status === 'done').length;

  const lines = [
    `Branch: ${config.git.branch}${state === undefined ? ' (no run yet)' : ''}`,
    `Files: ${String(graph.files.length)} · done: ${String(done)} · failed: ${String(failed.length)} · ` +
      `pending: ${String(graph.files.length - done - failed.length)}`,
  ];
  let input = 0;
  let output = 0;
  const findings: { file: string; bug: BugReport }[] = [];
  for (const [file, record] of records) {
    input += record?.usage?.inputTokens ?? 0;
    output += record?.usage?.outputTokens ?? 0;
    for (const bug of record?.bugs ?? []) findings.push({ file, bug });
  }
  const rank = (b: BugReport): number =>
    b.severity === undefined ? RANKS.length : RANKS.indexOf(b.severity);
  findings.sort(
    (a, b) =>
      rank(a.bug) - rank(b.bug) || compare(a.file, b.file) || (a.bug.line ?? 0) - (b.bug.line ?? 0),
  );
  const count = (s?: Severity): number => findings.filter((f) => f.bug.severity === s).length;
  const bugs = findings.map(
    ({ file, bug }) =>
      `  [${bug.severity ?? 'unrated'}] ${file}${bug.line === undefined ? '' : `:${String(bug.line)}`}  ${bug.reason}` +
      (bug.step === undefined ? '' : `  (${bug.step})`),
  );
  lines.push(
    `Tokens: ${String(input + output)} (input ${String(input)} · output ${String(output)}) · ` +
      `reported bugs: ${String(bugs.length)} (high ${String(count('high'))} · medium ${String(count('medium'))} · ` +
      `low ${String(count('low'))} · unrated ${String(count(undefined))})`,
  );
  if (failed.length > 0) {
    lines.push('', `Failed (${String(failed.length)}):`);
    for (const [file, record] of failed) {
      lines.push(`  ${file}  ${(record?.reason ?? '').split('\n')[0] ?? ''}`);
    }
  }
  if (bugs.length > 0) {
    lines.push('', `Reported bugs (${String(bugs.length)}):`, ...bugs);
  }
  return `${lines.join('\n')}\n`;
}
