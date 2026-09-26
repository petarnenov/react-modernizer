import { runCommand } from '../../run/gates.js';
import { defineTool, type ModelTool } from '../../model/client.js';
import { z } from 'zod';

/** Type-check output lines about the given files, with their continuation lines. */
export function errorsFor(output: string, files: readonly string[]): string {
  const kept: string[] = [];
  let keeping = false;
  for (const line of output.split('\n')) {
    if (/^\s/.test(line) && line.trim() !== '') {
      if (keeping) kept.push(line);
      continue;
    }
    keeping = files.some((f) => line.startsWith(f));
    if (keeping) kept.push(line);
  }
  return kept.join('\n').trim();
}

/** Runs the type check and returns the errors in `files`; empty when there are none. */
export async function typeErrors(
  command: string,
  cwd: string,
  files: readonly string[],
  timeoutSeconds: number,
): Promise<string> {
  // Whole output: the project's other errors must not push the step's own out of a truncated tail.
  const result = await runCommand(command, cwd, timeoutSeconds, { full: true });
  return result.ok ? '' : errorsFor(result.output, files);
}

/** `check_types`: the type check filtered to the step's files, so the model is not flooded by others' errors. */
export function checkTypesTool(
  command: string,
  cwd: string,
  files: readonly string[],
  timeoutSeconds: number,
): ModelTool<never> {
  return defineTool({
    name: 'check_types',
    description: `Type-check the project and get the errors in ${files.join(' and ')}. Empty means none.`,
    inputSchema: z.object({}),
    run: async () =>
      (await typeErrors(command, cwd, files, timeoutSeconds)) || 'no type errors in your files',
  });
}
