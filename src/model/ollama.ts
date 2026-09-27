import { z } from 'zod';
import type { Effort } from '../config/schema.js';
import {
  ModelAccessError,
  sortModels,
  type ModelClient,
  type ModelInfo,
  type ModelTool,
  type ToolRunRequest,
  type ToolRunResult,
} from './client.js';
import { toolDetail } from '../run/progress.js';
import { optionalDetail } from './anthropic.js';
import { systemClock, type Clock, type RateLimiter } from './rate-limit.js';
import type { UsageMeter } from './usage.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OllamaOptions {
  baseUrl: string;
  /** Name of the environment variable holding the key; read when a request is made. */
  apiKeyEnv: string;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  clock?: Clock;
}

interface ToolCall {
  function: { name: string; arguments: unknown };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

/** A message as kept locally, with what compaction needs to know about it. */
interface Recorded extends ChatMessage {
  /** The turn that produced it (assistant messages and tool results). */
  turn?: number;
  /** What a tool result becomes once it is no longer sent in full. */
  note?: string;
  /** The path a `read_file` result is the content of. */
  path?: string;
}

/** How many of the latest turns keep their tool results and reasoning in full. */
const FULL_RESULT_TURNS = 2;

/**
 * What is sent on request `turn`. Tool results from the last two turns go in full, older ones as a one-line note,
 * except the latest read of each of the step's own files, which always goes in full; an earlier read of the same
 * own file is superseded and becomes a note. Assistant messages older than two turns lose their `thinking`; their
 * text and tool calls stay, so every tool result still answers its call. Without this, every earlier file read,
 * test run and chain of reasoning is sent again on every turn.
 */
export function compact(
  messages: readonly Recorded[],
  turn: number,
  ownFiles: readonly string[] = [],
): ChatMessage[] {
  const own = new Set(ownFiles);
  const latestRead = new Map<string, number>();
  messages.forEach((m, i) => {
    if (
      m.role === 'tool' &&
      m.tool_name === 'read_file' &&
      m.path !== undefined &&
      own.has(m.path)
    ) {
      latestRead.set(m.path, i);
    }
  });
  return messages.map((m, i) => {
    const { turn: produced, note, path, ...message } = m;
    if (produced === undefined) return message;
    const old = produced < turn - FULL_RESULT_TURNS;
    if (message.role === 'assistant') {
      if (!old) return message;
      const rest: ChatMessage = { ...message };
      delete rest.thinking;
      return rest;
    }
    if (path !== undefined && latestRead.has(path)) {
      return latestRead.get(path) === i ? message : { ...message, content: note ?? '' };
    }
    return old ? { ...message, content: note ?? '' } : message;
  });
}

function argumentsOf(call: ToolCall): unknown {
  const input = call.function.arguments;
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}

interface ChatResponse {
  message: ChatMessage;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

const REQUEST_TIMEOUT_MS = 10 * 60_000;
/** Waits before the first and second retry, as the Anthropic SDK's `maxRetries: 2`. */
const RETRY_DELAYS_MS = [2_000, 8_000];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** gpt-oss thinks at `low`, `medium` or `high`; anything above is `high`. */
export function thinkLevel(effort: Effort): 'low' | 'medium' | 'high' {
  return effort === 'low' || effort === 'medium' ? effort : 'high';
}

class TransientError extends Error {}

/** {@link ModelClient} over Ollama's native chat API: Ollama Cloud, or a local server. */
export class OllamaModelClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetch: FetchLike;
  private readonly clock: Clock;

  constructor(
    private readonly limiter: RateLimiter,
    private readonly options: OllamaOptions,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.env = options.env ?? process.env;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.clock = options.clock ?? systemClock;
  }

  private headers(): Record<string, string> {
    const key = this.env[this.options.apiKeyEnv];
    if (key !== undefined && key !== '') {
      return { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    }
    if (!LOOPBACK.has(new URL(this.baseUrl).hostname)) {
      throw new ModelAccessError(
        `No API key for ${this.baseUrl}: set ${this.options.apiKeyEnv} (model.apiKeyEnv)`,
      );
    }
    return { 'content-type': 'application/json' };
  }

  /** One HTTP exchange; rate-limit, server and network errors are retried, anything else is not. */
  private async request(path: string, body?: unknown): Promise<unknown> {
    const headers = this.headers();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(path, headers, body);
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (!(error instanceof TransientError) || delay === undefined) {
          throw error instanceof TransientError
            ? new Error(error.message, { cause: error })
            : error;
        }
        await this.clock.sleep(delay);
      }
    }
  }

  private async once(path: string, headers: Record<string, string>, body?: unknown) {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(
          `the Ollama request timed out after ${String(REQUEST_TIMEOUT_MS / 60_000)} minutes`,
          { cause: error },
        );
      }
      throw new TransientError(
        `Ollama could not be reached at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (response.ok) {
      return response.json();
    }
    const text = (await response.text()).slice(0, 500);
    const message = `Ollama answered ${String(response.status)}: ${text}`;
    if (response.status === 401 || response.status === 403) {
      throw new ModelAccessError(
        `Ollama rejected the credentials: check ${this.options.apiKeyEnv} (${message})`,
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new TransientError(message);
    }
    throw new Error(message);
  }

  async listModels(): Promise<ModelInfo[]> {
    await this.limiter.acquire();
    let listed: unknown;
    try {
      listed = await this.request('/api/tags');
    } catch (error) {
      if (error instanceof ModelAccessError) throw error;
      throw new ModelAccessError(error instanceof Error ? error.message : String(error));
    }
    const entries =
      (
        listed as {
          models?: { name?: string; model?: string; size?: number; modified_at?: string }[];
        }
      ).models ?? [];
    return sortModels(
      entries.flatMap((m) => {
        const name = m.name ?? m.model;
        if (name === undefined) return [];
        return [
          {
            name,
            ...(typeof m.size === 'number' ? { size: m.size } : {}),
            ...(typeof m.modified_at === 'string' ? { modifiedAt: m.modified_at } : {}),
          },
        ];
      }),
    );
  }

  async check(model: string): Promise<void> {
    const names = (await this.listModels()).map((m) => m.name);
    if (!names.includes(model)) {
      const some = [...new Set(names)].slice(0, 10).join(', ');
      throw new ModelAccessError(
        `Model not found on ${this.baseUrl}: ${model}${some === '' ? '' : ` (available: ${some})`}`,
      );
    }
  }

  async runTools(request: ToolRunRequest, meter: UsageMeter): Promise<ToolRunResult> {
    const byName = new Map(request.tools.map((tool) => [tool.name, tool]));
    const tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: parametersOf(tool),
      },
    }));
    const messages: Recorded[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ];

    let last: ChatResponse | undefined;
    for (let turn = 0; turn < request.maxIterations; turn++) {
      meter.assertWithinBudget();
      await this.limiter.acquire((ms) => request.progress?.({ kind: 'rate-wait', ms }));
      request.progress?.({ kind: 'model-turn', turn: turn + 1 });
      last = (await this.request('/api/chat', {
        model: request.model,
        messages: compact(messages, turn, request.ownFiles),
        tools,
        stream: false,
        think: thinkLevel(request.effort),
      })) as ChatResponse;
      meter.add({ input_tokens: last.prompt_eval_count ?? 0, output_tokens: last.eval_count ?? 0 });
      if (last.done_reason === 'length') {
        throw new Error('the model response was cut off at the output length limit');
      }
      const calls = last.message.tool_calls ?? [];
      // Sent back as returned, thinking included: gpt-oss continues its reasoning from it.
      messages.push({ ...last.message, turn });
      if (calls.length === 0) {
        break;
      }
      for (const call of calls) {
        const input = argumentsOf(call);
        const detail = toolDetail(call.function.name, input);
        const readPath =
          call.function.name === 'read_file' &&
          typeof (input as { path?: unknown } | undefined)?.path === 'string'
            ? (input as { path: string }).path
            : undefined;
        messages.push({
          role: 'tool',
          tool_name: call.function.name,
          content: await runCall(byName.get(call.function.name), call, request.progress),
          turn,
          note: `[earlier result of ${call.function.name}${detail === undefined ? '' : ` ${detail}`} omitted — call it again if you need it]`,
          ...(readPath === undefined ? {} : { path: readPath }),
        });
      }
    }
    if (last === undefined) {
      throw new Error('the model returned no response');
    }
    return { text: last.message.content.trim() };
  }
}

function parametersOf(tool: ModelTool<never>): object {
  const schema: Record<string, unknown> = z.toJSONSchema(tool.inputSchema as z.ZodType);
  delete schema.$schema;
  return schema;
}

/** Runs one tool call; every failure goes back to the model as text, so it can correct itself. */
async function runCall(
  tool: ModelTool<never> | undefined,
  call: ToolCall,
  progress: ToolRunRequest['progress'],
): Promise<string> {
  if (tool === undefined) {
    return `Error: unknown tool ${call.function.name}`;
  }
  let input = call.function.arguments;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input) as unknown;
    } catch {
      return `Error: the arguments of ${call.function.name} are not valid JSON`;
    }
  }
  const parsed = (tool.inputSchema as z.ZodType).safeParse(input ?? {});
  if (!parsed.success) {
    return `Error: invalid input for ${call.function.name}:\n${z.prettifyError(parsed.error)}`;
  }
  progress?.({ kind: 'tool-call', tool: tool.name, ...optionalDetail(tool.name, parsed.data) });
  try {
    return await tool.run(parsed.data as never);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
