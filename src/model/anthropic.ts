import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  ModelAccessError,
  ModelRefusalError,
  sortModels,
  type ModelClient,
  type ModelInfo,
  type ToolRunRequest,
  type ToolRunResult,
} from './client.js';
import { toolDetail } from '../run/progress.js';
import type { RateLimiter } from './rate-limit.js';
import type { UsageMeter } from './usage.js';

/** The part of the SDK client this uses — small enough to stub in tests. */
export interface AnthropicLike {
  models: {
    retrieve(model: string): Promise<unknown>;
    list(): AsyncIterable<{ id: string; created_at: string }>;
  };
  beta: { messages: { toolRunner: Anthropic['beta']['messages']['toolRunner'] } };
}

const CREDENTIALS_HINT = 'set ANTHROPIC_API_KEY, or run `ant auth login`';

/** Models with server-side refusal fallbacks on by default: the Opus 5 and Fable families. */
function wantsFallbacks(model: string): boolean {
  return model.startsWith('claude-opus-5') || model.startsWith('claude-fable-5');
}

function textOf(message: BetaMessage): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();
}

export function optionalDetail(tool: string, input: unknown): { detail?: string } {
  const detail = toolDetail(tool, input);
  return detail === undefined ? {} : { detail };
}

/** What a failed models request means for the user; `model` is the one asked for, if any. */
function accessError(error: unknown, model: string | undefined): ModelAccessError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ModelAccessError(`The model API rejected the credentials: ${CREDENTIALS_HINT}`);
  }
  if (error instanceof Anthropic.NotFoundError && model !== undefined) {
    return new ModelAccessError(`Model not found: ${model}`);
  }
  if (error instanceof Anthropic.APIError) {
    return new ModelAccessError(`The model API could not be reached: ${error.message}`);
  }
  // No credentials at all surfaces as a plain SDK error from the constructor or the request.
  return new ModelAccessError(
    `No credentials for the model API (${error instanceof Error ? error.message : String(error)}): ${CREDENTIALS_HINT}`,
  );
}

/** {@link ModelClient} over the official SDK's tool runner. */
export class AnthropicModelClient implements ModelClient {
  private client: AnthropicLike | undefined;

  constructor(
    private readonly limiter: RateLimiter,
    client?: AnthropicLike,
  ) {
    this.client = client;
  }

  private sdk(): AnthropicLike {
    // Created lazily: the SDK resolves credentials (API key, auth token, `ant` profile) at construction.
    this.client ??= new Anthropic({ maxRetries: 2 });
    return this.client;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      await this.limiter.acquire();
      const models: ModelInfo[] = [];
      for await (const m of this.sdk().models.list()) {
        models.push({ name: m.id, modifiedAt: m.created_at });
      }
      return sortModels(models);
    } catch (error) {
      throw accessError(error, undefined);
    }
  }

  async check(model: string): Promise<void> {
    try {
      await this.limiter.acquire();
      await this.sdk().models.retrieve(model);
    } catch (error) {
      throw accessError(error, model);
    }
  }

  async runTools(request: ToolRunRequest, meter: UsageMeter): Promise<ToolRunResult> {
    const runner = this.sdk().beta.messages.toolRunner({
      model: request.model,
      max_tokens: 16_000,
      max_iterations: request.maxIterations,
      thinking: { type: 'adaptive' },
      output_config: { effort: request.effort },
      // The system prompt and tool list are the same for every file: cache them.
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      tools: request.tools.map((tool) =>
        betaZodTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          run: (input) => {
            request.progress?.({
              kind: 'tool-call',
              tool: tool.name,
              ...optionalDetail(tool.name, input),
            });
            return tool.run(input);
          },
        }),
      ),
      messages: [{ role: 'user', content: request.prompt }],
      ...(wantsFallbacks(request.model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    });

    // Iterated by hand: each step of the iterator is one request, so the rate limit and the budget apply per request.
    const iterator = runner[Symbol.asyncIterator]();
    let last: BetaMessage | undefined;
    for (let turn = 1; ; turn++) {
      meter.assertWithinBudget();
      await this.limiter.acquire((ms) => request.progress?.({ kind: 'rate-wait', ms }));
      request.progress?.({ kind: 'model-turn', turn });
      const next = await iterator.next();
      if (next.done === true) {
        break;
      }
      const message = next.value;
      meter.add(message.usage);
      if (message.stop_reason === 'refusal') {
        throw new ModelRefusalError(
          `the model declined the request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`,
        );
      }
      last = message;
    }
    if (last === undefined) {
      throw new Error('the model returned no response');
    }
    if (last.stop_reason === 'max_tokens') {
      throw new Error('the model response was cut off at max_tokens');
    }
    return { text: textOf(last) };
  }
}
