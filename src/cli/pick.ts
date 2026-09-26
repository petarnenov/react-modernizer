import { emitKeypressEvents } from 'node:readline';
import type { ModelInfo } from '../model/client.js';

const VISIBLE_ROWS = 10;

/** Models whose name contains every word of `query`, in any order, ignoring case. */
export function filterModels(models: readonly ModelInfo[], query: string): ModelInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => words.every((w) => m.name.toLowerCase().includes(w)));
}

export interface PickerState {
  readonly models: readonly ModelInfo[];
  readonly query: string;
  readonly matches: readonly ModelInfo[];
  /** Index into `matches`. */
  readonly selected: number;
  readonly done?: { chosen: string } | { cancelled: true };
}

export type PickerKey =
  | { kind: 'char'; text: string }
  | { kind: 'backspace' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'enter' }
  | { kind: 'cancel' };

export function initialState(models: readonly ModelInfo[], current?: string): PickerState {
  const at = models.findIndex((m) => m.name === current);
  return { models, query: '', matches: models, selected: Math.max(at, 0) };
}

/** Where the picker goes on a key. Pure, so the whole behaviour is testable without a terminal. */
export function press(state: PickerState, key: PickerKey): PickerState {
  if (state.done !== undefined) return state;
  switch (key.kind) {
    case 'char':
    case 'backspace': {
      const query = key.kind === 'char' ? state.query + key.text : state.query.slice(0, -1);
      const previous = state.matches[state.selected]?.name;
      const matches = filterModels(state.models, query);
      // Keep the same model selected while it still matches.
      const kept = matches.findIndex((m) => m.name === previous);
      return { ...state, query, matches, selected: Math.max(kept, 0) };
    }
    case 'up':
      return { ...state, selected: Math.max(state.selected - 1, 0) };
    case 'down':
      return {
        ...state,
        selected: Math.min(state.selected + 1, Math.max(state.matches.length - 1, 0)),
      };
    case 'enter': {
      const chosen = state.matches[state.selected]?.name;
      return chosen === undefined ? state : { ...state, done: { chosen } };
    }
    case 'cancel':
      return { ...state, done: { cancelled: true } };
  }
}

function formatSize(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 10
    ? `${gb.toFixed(0)} GB`
    : gb >= 1
      ? `${gb.toFixed(1)} GB`
      : `${(bytes / 1e6).toFixed(0)} MB`;
}

export function describeModel(model: ModelInfo): string {
  const facts = [
    ...(model.size === undefined ? [] : [formatSize(model.size)]),
    ...(model.modifiedAt === undefined ? [] : [model.modifiedAt.slice(0, 10)]),
  ];
  return facts.join(' · ');
}

/** The picker's lines: the prompt, at most ten rows around the selection, and the count. */
export function renderPicker(state: PickerState, title: string): string[] {
  const start = Math.min(
    Math.max(state.selected - Math.floor(VISIBLE_ROWS / 2), 0),
    Math.max(state.matches.length - VISIBLE_ROWS, 0),
  );
  const shown = state.matches.slice(start, start + VISIBLE_ROWS);
  const width = Math.max(0, ...shown.map((m) => m.name.length));
  const rows = shown.map((m, i) => {
    const facts = describeModel(m);
    const name = facts === '' ? m.name : `${m.name.padEnd(width)}  ${facts}`;
    return `${start + i === state.selected ? '  ❯ ' : '    '}${name}`;
  });
  return [
    `${title} › ${state.query}`,
    ...(rows.length === 0 ? ['    no model matches'] : rows),
    `  ${String(state.matches.length)} of ${String(state.models.length)} · ↑↓ move · Enter choose · Esc cancel`,
  ];
}

interface Keypress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  sequence?: string;
}

function toKey(text: string | undefined, key: Keypress): PickerKey | undefined {
  if (key.ctrl === true && key.name === 'c') return { kind: 'cancel' };
  switch (key.name) {
    case 'escape':
      return { kind: 'cancel' };
    case 'return':
    case 'enter':
      return { kind: 'enter' };
    case 'backspace':
      return { kind: 'backspace' };
    case 'up':
      return { kind: 'up' };
    case 'down':
      return { kind: 'down' };
  }
  if (text !== undefined && key.ctrl !== true && key.meta !== true && /^[\x20-\x7e]$/.test(text)) {
    return { kind: 'char', text };
  }
  return undefined;
}

/**
 * Lets the user choose a model in the terminal. Resolves with the name, or undefined when cancelled. Raw mode is
 * always restored.
 */
export function pickInTerminal(
  input: NodeJS.ReadStream,
  write: (text: string) => void,
  models: readonly ModelInfo[],
  current: string | undefined,
  title: string,
): Promise<string | undefined> {
  let state = initialState(models, current);
  let drawn = 0;
  const draw = () => {
    const lines = renderPicker(state, title);
    write(`${drawn > 0 ? `\x1b[${String(drawn)}A\r\x1b[J` : ''}${lines.join('\n')}\n`);
    drawn = lines.length;
  };

  return new Promise((resolve) => {
    emitKeypressEvents(input);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    const finish = (value: string | undefined) => {
      input.off('keypress', onKey);
      input.setRawMode(wasRaw);
      input.pause();
      resolve(value);
    };
    const onKey = (text: string | undefined, key: Keypress) => {
      const mapped = toKey(text, key);
      if (mapped === undefined) return;
      state = press(state, mapped);
      draw();
      if (state.done !== undefined) finish('chosen' in state.done ? state.done.chosen : undefined);
    };
    input.on('keypress', onKey);
    draw();
  });
}
