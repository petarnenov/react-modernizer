import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { defineTool, type ModelTool } from '../../model/client.js';
import { runCommand, shellQuote } from '../../run/gates.js';
import type { BugReport } from '../step.js';

const READ_LIMIT = 200_000;
const HIDDEN = new Set(['node_modules', '.git']);

export interface ToolOptions {
  /** The target's directory in the worktree. */
  cwd: string;
  /** The characterization test file, relative to `cwd` — the only file the model may write. */
  testPath: string;
  /** Command that runs the tests; `{testFile}` is replaced by the quoted test path. */
  testCommand: string;
  timeoutSeconds: number;
  report(bug: BugReport): void;
}

/**
 * Resolves a model-supplied path inside the target, or throws the reason it is refused. Symlinks are followed, so a
 * link cannot lead outside; `node_modules`, `.git` and `.env*` files are never readable.
 */
export async function confine(cwd: string, path: string): Promise<string> {
  if (isAbsolute(path)) {
    throw new Error(
      `absolute paths are not allowed; use a path relative to the project root: ${path}`,
    );
  }
  const absolute = resolve(cwd, path);
  const inside = relative(cwd, absolute);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`path is outside the project: ${path}`);
  }
  const segments = inside.split(sep);
  if (segments.some((s) => HIDDEN.has(s))) {
    throw new Error(`path is not readable (node_modules and .git are off limits): ${path}`);
  }
  if (basename(absolute).startsWith('.env')) {
    throw new Error(`environment files are not readable: ${path}`);
  }
  const real = await realpath(absolute).catch(() => absolute);
  const realRoot = await realpath(cwd);
  const realInside = relative(realRoot, real);
  if (realInside.startsWith('..') || isAbsolute(realInside)) {
    throw new Error(`path leads outside the project through a link: ${path}`);
  }
  return absolute;
}

export function createTools(options: ToolOptions): ModelTool<never>[] {
  const { cwd, testPath } = options;

  return [
    defineTool({
      name: 'read_file',
      description:
        'Read a file of the project, by path relative to the project root. Use it for the file under test, what it ' +
        'imports, test helpers, and existing tests.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Path relative to the project root'),
      }),
      run: async ({ path }) => {
        const absolute = await confine(cwd, path);
        const text = await readFile(absolute, 'utf8');
        return text.length <= READ_LIMIT
          ? text
          : `${text.slice(0, READ_LIMIT)}\n… [truncated at ${String(READ_LIMIT)} characters]`;
      },
    }),
    defineTool({
      name: 'list_directory',
      description: 'List the entries of a project directory; directories end with "/".',
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe('Directory relative to the project root, "." for the root'),
      }),
      run: async ({ path }) => {
        const absolute = await confine(cwd, path);
        if (!(await stat(absolute)).isDirectory()) {
          throw new Error(`not a directory: ${path}`);
        }
        const entries = await readdir(absolute, { withFileTypes: true });
        return entries
          .filter((e) => !HIDDEN.has(e.name) && !e.name.startsWith('.env'))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join('\n');
      },
    }),
    defineTool({
      name: 'write_test_file',
      description: `Write the complete characterization test file (${testPath}), replacing what is there. This is the only file you can write.`,
      inputSchema: z.object({ content: z.string().min(1).describe('The whole test file') }),
      run: async ({ content }) => {
        await writeFile(join(cwd, testPath), content);
        return `wrote ${testPath}`;
      },
    }),
    defineTool({
      name: 'run_tests',
      description: `Run the characterization tests (${testPath}) and get the output. Finish only when they pass.`,
      inputSchema: z.object({}),
      run: async () => {
        const command = options.testCommand.replaceAll('{testFile}', shellQuote(testPath));
        const result = await runCommand(command, cwd, options.timeoutSeconds);
        return `${result.ok ? 'PASSED' : 'FAILED'}\n${result.output.trim()}`;
      },
    }),
    defineTool({
      name: 'report_bug',
      description:
        'Record a suspected bug in the file under test. The tests must still assert what the code does now; this is ' +
        'how a bug gets noticed without changing behaviour.',
      inputSchema: z.object({
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('1-based line in the file under test'),
        reason: z.string().min(1).describe('What looks wrong and why'),
      }),
      run: ({ line, reason }) => {
        options.report(line === undefined ? { reason } : { line, reason });
        return Promise.resolve('recorded');
      },
    }),
  ];
}
