import { basename } from 'node:path';

import type { ModelProgress } from '../model/client.js';

export type { ModelProgress, ModelProgressSink } from '../model/client.js';

/** What the transaction reports for the file it processes. */
export type FileProgress =
  | ModelProgress
  | { kind: 'step-start'; step: string; attempt: number }
  | { kind: 'step-end'; step: string; ms: number; findings: number; changed: boolean }
  | { kind: 'retry'; step: string; attempt: number; reason: string }
  | { kind: 'gate-start'; command: string }
  | { kind: 'gate-end'; command: string; ok: boolean; ms: number };

export type ProgressEvent =
  | { kind: 'phase'; text: string }
  | { kind: 'file-start'; file: string; index: number; total: number }
  | { kind: 'file-end'; file: string }
  | (FileProgress & { file: string });

/** Where the run sends its progress events and its result lines. */
export interface ProgressRenderer {
  event(event: ProgressEvent): void;
  /** A permanent line: file results, warnings, the summary. */
  line(text: string): void;
  stop(): void;
}

/**
 * The part of a tool's input that is safe and useful to show: the path it touches, or the line of a finding. File
 * contents, reasons and anything else stay out.
 */
export function toolDetail(tool: string, input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const { path, line } = input as { path?: unknown; line?: unknown };
  if (typeof path === 'string') return path;
  if (tool === 'report_bug' && typeof line === 'number') return `line ${String(line)}`;
  return undefined;
}

export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  return `${String(Math.floor(seconds / 60))}m${String(seconds % 60).padStart(2, '0')}s`;
}

export function formatTokens(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`;
}

const shortCommand = (command: string) =>
  command.length <= 60 ? command : `${command.slice(0, 57)}...`;

const firstLine = (text: string) => text.split('\n', 1)[0] ?? '';

/** What a model or gate activity looks like in a status line. */
function activity(event: ProgressEvent): string | undefined {
  switch (event.kind) {
    case 'model-turn':
      return `turn ${String(event.turn)}`;
    case 'tool-call':
      return event.detail === undefined ? event.tool : `${event.tool} ${event.detail}`;
    case 'rate-wait':
      return `waiting ${formatDuration(event.ms)} for the rate limit`;
    case 'gate-start':
      return `gate ${shortCommand(event.command)}`;
    default:
      return undefined;
  }
}

/** Tracks where each file is in the run, for labels like `[2/7] Card.jsx`. */
class Positions {
  private readonly at = new Map<string, string>();

  start(file: string, index: number, total: number): void {
    this.at.set(file, `[${String(index)}/${String(total)}] ${basename(file)}`);
  }

  label(file: string): string {
    return this.at.get(file) ?? basename(file);
  }

  end(file: string): void {
    this.at.delete(file);
  }
}

/** The permanent line for an event, if it gets one; `label` is the file's position. */
function permanent(event: ProgressEvent, label: (file: string) => string): string | undefined {
  switch (event.kind) {
    case 'phase':
      return `· ${event.text}`;
    case 'step-end': {
      const what = event.changed ? '✓' : '✓ unchanged';
      const findings =
        event.findings === 0
          ? ''
          : ` · ${String(event.findings)} finding${event.findings === 1 ? '' : 's'}`;
      return `  ${label(event.file)} · ${event.step} ${what}${findings} (${formatDuration(event.ms)})`;
    }
    case 'gate-end':
      return `  ${label(event.file)} · gate ${shortCommand(event.command)} ${event.ok ? '✓' : '✗'} ${formatDuration(event.ms)}`;
    case 'retry':
      return `  ${label(event.file)} · ${event.step} attempt ${String(event.attempt + 1)}: ${firstLine(event.reason)}`;
    default:
      return undefined;
  }
}

const clockTime = (date: Date) => date.toTimeString().slice(0, 8);

/** Every event as a plain, timestamped line: for pipes, files and CI. */
export class PlainProgress implements ProgressRenderer {
  private readonly positions = new Positions();

  constructor(
    private readonly write: (text: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  event(event: ProgressEvent): void {
    if (event.kind === 'file-start') {
      this.positions.start(event.file, event.index, event.total);
      this.print(`${this.positions.label(event.file)} · start`);
      return;
    }
    if (event.kind === 'file-end') {
      this.positions.end(event.file);
      return;
    }
    const label = (file: string) => this.positions.label(file);
    let text = permanent(event, label)?.trimStart();
    if (text === undefined && 'file' in event) {
      const detail =
        event.kind === 'step-start'
          ? `${event.step} attempt ${String(event.attempt + 1)}`
          : activity(event);
      if (detail !== undefined) text = `${label(event.file)} · ${detail}`;
    }
    if (text !== undefined) this.print(text);
  }

  line(text: string): void {
    this.print(text);
  }

  stop(): void {
    // Nothing to clean up.
  }

  private print(text: string): void {
    this.write(`${clockTime(this.now())} ${text}\n`);
  }
}

const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

interface Status {
  step: string;
  attempt: number;
  activity: string;
  since: number;
}

/**
 * A live status line per file being processed, redrawn in place, with permanent lines printed above it. Owns the
 * terminal while the run lasts: everything the run prints goes through it.
 */
export class TerminalProgress implements ProgressRenderer {
  private readonly positions = new Positions();
  private readonly statuses = new Map<string, Status>();
  private drawn = 0;
  private frame = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly write: (text: string) => void,
    private readonly columns: () => number = () => process.stdout.columns,
    private readonly now: () => number = () => Date.now(),
    intervalMs = 100,
  ) {
    this.timer = setInterval(() => {
      this.frame++;
      this.redraw([]);
    }, intervalMs);
    this.timer.unref();
  }

  event(event: ProgressEvent): void {
    const label = (file: string) => this.positions.label(file);
    switch (event.kind) {
      case 'file-start':
        this.positions.start(event.file, event.index, event.total);
        this.statuses.set(event.file, {
          step: '',
          attempt: 0,
          activity: 'starting',
          since: this.now(),
        });
        break;
      case 'file-end':
        this.statuses.delete(event.file);
        break;
      case 'step-start': {
        const status = this.statuses.get(event.file);
        if (status !== undefined) {
          status.step = event.step;
          status.attempt = event.attempt;
          status.activity = 'preparing';
        }
        break;
      }
      default: {
        const status = 'file' in event ? this.statuses.get(event.file) : undefined;
        const text = activity(event);
        if (status !== undefined && text !== undefined) status.activity = text;
      }
    }
    const line = permanent(event, label);
    this.redraw(line === undefined ? [] : [line]);
    if (event.kind === 'file-end') this.positions.end(event.file);
  }

  line(text: string): void {
    this.redraw([text]);
  }

  stop(): void {
    clearInterval(this.timer);
    this.statuses.clear();
    this.redraw([]);
  }

  private redraw(lines: string[]): void {
    const width = Math.max(20, this.columns() || 80);
    let out = this.drawn > 0 ? `\x1b[${String(this.drawn)}A\r\x1b[J` : '';
    for (const line of lines) out += `${line}\n`;
    const spinner = SPINNER[this.frame % SPINNER.length] ?? '*';
    const block = [...this.statuses].map(([file, s]) => {
      const step =
        s.step === ''
          ? ''
          : ` · ${s.step}${s.attempt > 0 ? ` · attempt ${String(s.attempt + 1)}` : ''}`;
      const elapsed = formatDuration(this.now() - s.since);
      const text = `${spinner} ${this.positions.label(file)}${step} · ${s.activity} · ${elapsed}`;
      // Cut to the terminal width: a wrapped line would break the count of lines to redraw.
      return text.length < width ? text : `${text.slice(0, width - 2)}…`;
    });
    for (const line of block) out += `${line}\n`;
    this.drawn = block.length;
    if (out !== '') this.write(out);
  }
}
