import { isAbsolute, relative, sep } from 'node:path';

export const ERROR_FORMATS = ['tsc', 'eslint'] as const;
export type ErrorFormat = (typeof ERROR_FORMATS)[number];

/** One error a tool reported: where, and what — the text without the position, so moved code is the same error. */
export interface ReportedError {
  file: string;
  /** `TS2345 Argument of type…` or `no-unused-vars 'x' is defined…`. */
  what: string;
  /** The error as the tool printed it, for the model. */
  text: string;
}

/** Counts per file and error text: `file` → `what` → how many. */
export type ErrorCounts = Record<string, Record<string, number>>;

const TSC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

interface EslintResult {
  filePath: string;
  messages: {
    ruleId: string | null;
    severity: number;
    message: string;
    line?: number;
    column?: number;
  }[];
}

/**
 * ESLint's `json` formatter, built into every version (unlike `unix`, which ESLint 9 dropped): one line holding an
 * array of results. Only errors (severity 2) count; warnings do not fail eslint.
 */
function parseEslintJson(output: string, cwds: readonly string[]): ReportedError[] {
  const line = output.split('\n').find((l) => l.trimStart().startsWith('['));
  if (line === undefined) return [];
  let results: EslintResult[];
  try {
    results = JSON.parse(line) as EslintResult[];
  } catch {
    return [];
  }
  return results.flatMap((r) =>
    r.messages
      .filter((m) => m.severity === 2)
      .map((m) => {
        const file = normalise(r.filePath, cwds);
        const rule = m.ruleId ?? 'eslint';
        return {
          file,
          what: `${rule} ${m.message}`,
          text: `${file}:${String(m.line ?? 0)}:${String(m.column ?? 0)}: ${m.message} [${rule}]`,
        };
      }),
  );
}

/** Paths relative to `cwd`, with `/` separators, whether the tool printed them relative or absolute. */
function normalise(file: string, cwds: readonly string[]): string {
  let path = file;
  if (isAbsolute(file)) {
    for (const cwd of cwds) {
      const inside = relative(cwd, file);
      if (!inside.startsWith('..') && !isAbsolute(inside)) {
        path = inside;
        break;
      }
    }
  }
  return path.split(sep).join('/');
}

/**
 * The errors in a tool's complete output: tsc's text, or ESLint's `--format json`. `cwds` are the directory the
 * command ran in and its real path, to make absolute paths (ESLint prints them) relative.
 */
export function parseErrors(
  format: ErrorFormat,
  output: string,
  cwds: readonly string[],
): ReportedError[] {
  return format === 'tsc' ? parseTsc(output, cwds) : parseEslintJson(output, cwds);
}

/** `file(line,col): error TSnnnn: message`, with indented continuation lines belonging to the error above. */
function parseTsc(output: string, cwds: readonly string[]): ReportedError[] {
  const errors: ReportedError[] = [];
  for (const line of output.split('\n')) {
    const last = errors.at(-1);
    if (last !== undefined && /^\s+\S/.test(line)) {
      last.what += `\n${line.trim()}`;
      last.text += `\n${line}`;
      continue;
    }
    const m = TSC.exec(line);
    if (m?.[1] !== undefined) {
      errors.push({ file: normalise(m[1], cwds), what: `${m[4] ?? ''} ${m[5] ?? ''}`, text: line });
    }
  }
  return errors;
}

export function countErrors(errors: readonly ReportedError[]): ErrorCounts {
  const counts: ErrorCounts = {};
  for (const e of errors) {
    const perFile = (counts[e.file] ??= {});
    perFile[e.what] = (perFile[e.what] ?? 0) + 1;
  }
  return counts;
}

export function totalErrors(counts: ErrorCounts): number {
  return Object.values(counts).reduce(
    (sum, perFile) => sum + Object.values(perFile).reduce((a, b) => a + b, 0),
    0,
  );
}

/**
 * The errors that are new against `baseline`: for each file and error text, those beyond the baseline's count.
 * `baseName` maps a file's current path to the path it had in the baseline (a renamed file keeps its errors).
 */
export function newErrors(
  errors: readonly ReportedError[],
  baseline: ErrorCounts,
  baseName: (file: string) => string = (f) => f,
): ReportedError[] {
  const left: ErrorCounts = structuredClone(baseline);
  const fresh: ReportedError[] = [];
  for (const e of errors) {
    const perFile = left[baseName(e.file)];
    const remaining = perFile?.[e.what] ?? 0;
    if (perFile !== undefined && remaining > 0) {
      perFile[e.what] = remaining - 1;
    } else {
      fresh.push(e);
    }
  }
  return fresh;
}

/** Merges counts, e.g. per-file baselines into one. */
export function mergeCounts(target: ErrorCounts, more: ErrorCounts): void {
  for (const [file, perFile] of Object.entries(more)) {
    const into = (target[file] ??= {});
    for (const [what, n] of Object.entries(perFile)) into[what] = (into[what] ?? 0) + n;
  }
}
