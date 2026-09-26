import type { ModernizerConfig } from '../config/schema.js';
import { buildGraph } from '../graph/build.js';
import { openRepository } from './git.js';
import { statePath } from './runner.js';
import { loadState } from './state.js';
import { runDirectory } from './workspace.js';

/** A text summary of the saved run state: counts, and every failed file with its reason. */
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
  if (failed.length > 0) {
    lines.push('', `Failed (${String(failed.length)}):`);
    for (const [file, record] of failed) {
      lines.push(`  ${file}  ${(record?.reason ?? '').split('\n')[0] ?? ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
