import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { defineTool, type ModelTool } from '../../model/client.js';
import { runCommand } from '../../run/gates.js';
import { SEVERITIES, type BugReport } from '../step.js';

const READ_LIMIT = 200_000;
const HIDDEN = new Set(['node_modules', '.git']);

/**
 * The real path of `path`, or for a path that does not exist yet (a file about to be written), the real path of its
 * nearest existing directory with the rest appended — so a root reached through a link (`/var` → `/private/var`)
 * compares equal.
 */
async function realExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await realExisting(parent), basename(path));
  }
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
  const real = await realExisting(absolute);
  const realRoot = await realpath(cwd);
  const realInside = relative(realRoot, real);
  if (realInside.startsWith('..') || isAbsolute(realInside)) {
    throw new Error(`path leads outside the project through a link: ${path}`);
  }
  return absolute;
}

async function readLimited(absolute: string): Promise<string> {
  const text = await readFile(absolute, 'utf8');
  return text.length <= READ_LIMIT
    ? text
    : `${text.slice(0, READ_LIMIT)}\n… [truncated at ${String(READ_LIMIT)} characters]`;
}

/** `read_file` and `list_directory`, confined to the target. */
export function readTools(cwd: string): ModelTool<never>[] {
  return [
    defineTool({
      name: 'read_file',
      description:
        'Read a file of the project, by path relative to the project root. Use it for the file you work on, what ' +
        'it imports, test helpers, and existing tests.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Path relative to the project root'),
      }),
      run: async ({ path }) => readLimited(await confine(cwd, path)),
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
  ];
}

/** `read_file` for a fixed list of paths (relative to the target): a step that judges only its own file reads nothing else. */
export function readOwnFilesTool(cwd: string, paths: readonly string[]): ModelTool<never> {
  const allowed = new Set(paths);
  return defineTool({
    name: 'read_file',
    description: `Read one of these files, by path relative to the project root: ${paths.join(', ')}. No other file can be read.`,
    inputSchema: z.object({
      path: z.string().min(1).describe('Path relative to the project root'),
    }),
    run: async ({ path }) => {
      const absolute = await confine(cwd, path);
      if (!allowed.has(relative(cwd, absolute).split(sep).join('/'))) {
        throw new Error(`only these files can be read: ${paths.join(', ')}`);
      }
      return readLimited(absolute);
    },
  });
}

/** A write tool bound to one file: it takes content only, so there is no path to point anywhere else. */
export function writeOneFileTool(
  cwd: string,
  path: string,
  name: string,
  description: string,
): ModelTool<never> {
  return defineTool({
    name,
    description,
    inputSchema: z.object({ content: z.string().min(1).describe('The whole file') }),
    run: async ({ content }) => {
      await writeFile(join(cwd, path), content);
      return `wrote ${path}`;
    },
  });
}

/** `run_tests`: runs one fixed command — the model chooses nothing about it. */
export function runTestsTool(
  cwd: string,
  command: string,
  timeoutSeconds: number,
  description: string,
): ModelTool<never> {
  return defineTool({
    name: 'run_tests',
    description,
    inputSchema: z.object({}),
    run: async () => {
      const result = await runCommand(command, cwd, timeoutSeconds);
      return `${result.ok ? 'PASSED' : 'FAILED'}\n${result.output.trim()}`;
    },
  });
}

/** `report_bug`: records a suspected bug; behaviour is never changed to fix it. */
export function reportBugTool(
  report: (bug: BugReport) => void,
  description: string,
): ModelTool<never> {
  return defineTool({
    name: 'report_bug',
    description,
    inputSchema: z.object({
      line: z.number().int().positive().optional().describe('1-based line in the file'),
      severity: z
        .enum(SEVERITIES)
        .optional()
        .describe(
          'high: wrong behaviour users can hit, data loss, security; medium: wrong under specific conditions, ' +
            'races, leaks; low: fragile code a refactor could break',
        ),
      reason: z.string().min(1).describe('What looks wrong and why'),
    }),
    run: ({ line, severity, reason }) => {
      report({
        reason,
        ...(line === undefined ? {} : { line }),
        ...(severity === undefined ? {} : { severity }),
      });
      return Promise.resolve('recorded');
    },
  });
}
