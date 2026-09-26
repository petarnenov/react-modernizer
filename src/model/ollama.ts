import { z } from 'zod';
import type { Effort } from '../config/schema.js';
import {
  ModelAccessError,
  type ModelClient,
  type ModelTool,
  type ToolRunRequest,
  type ToolRunResult,
} from './client.js';
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

  async check(model: string): Promise<void> {
    await this.limiter.acquire();
    let listed: unknown;
    try {
      listed = await this.request('/api/tags');
    } catch (error) {
      if (error instanceof ModelAccessError) throw error;
      throw new ModelAccessError(error instanceof Error ? error.message : String(error));
    }
    const names = (
      (listed as { models?: { name?: string; model?: string }[] }).models ?? []
    ).flatMap((m) => [m.name, m.model].filter((n): n is string => n !== undefined));
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
    const messages: ChatMessage[] = [
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
        messages,
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
      messages.push(last.message);
      if (calls.length === 0) {
        break;
      }
      for (const call of calls) {
        messages.push({
          role: 'tool',
          tool_name: call.function.name,
          content: await runCall(byName.get(call.function.name), call, request.progress),
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
