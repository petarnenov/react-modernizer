import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicModelClient, type AnthropicLike } from '../src/model/anthropic.js';
import { defineTool, ModelAccessError, ModelRefusalError } from '../src/model/client.js';
import { RateLimiter, type Clock } from '../src/model/rate-limit.js';
import { BudgetExceededError, UsageMeter } from '../src/model/usage.js';

/** A clock that only moves when someone sleeps. */
function fakeClock(): Clock & { slept: number[] } {
  let now = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
}

describe('RateLimiter', () => {
  it('makes the second request of a minute wait for the next minute', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1, clock);

    await Promise.all([limiter.acquire(), limiter.acquire()]);

    expect(clock.slept).toEqual([60_000]);
  });

  it('does not wait under the limit', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(3, clock);
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);

    expect(clock.slept).toEqual([]);
  });
});

describe('UsageMeter', () => {
  it('counts cached input and stops at the budget', () => {
    const meter = new UsageMeter(1000);
    meter.add({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 400 });
    expect(meter.totals()).toEqual({ inputTokens: 500, outputTokens: 50 });
    expect(() => {
      meter.assertWithinBudget();
    }).not.toThrow();

    meter.add({ input_tokens: 400, output_tokens: 100 });
    expect(() => {
      meter.assertWithinBudget();
    }).toThrow(BudgetExceededError);
    expect(() => {
      meter.assertWithinBudget();
    }).toThrow('budget.maxTokensPerFile');
  });

  it('never runs out without a limit', () => {
    const meter = new UsageMeter();
    meter.add({ input_tokens: 10_000_000, output_tokens: 0 });
    expect(meter.exhausted).toBe(false);
  });
});

type Message = Pick<Anthropic.Beta.BetaMessage, 'content' | 'stop_reason' | 'usage'> & {
  stop_details?: { category: string } | null;
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    content: [{ type: 'text', text: 'done', citations: null }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 10 } as Anthropic.Beta.BetaUsage,
    ...overrides,
  };
}

/** A stand-in for the SDK client: records the tool-runner params and yields the given messages. */
function stubSdk(
  messages: Message[],
  retrieve: () => Promise<unknown> = () => Promise.resolve({}),
) {
  const params: unknown[] = [];
  const sdk = {
    models: { retrieve },
    beta: {
      messages: {
        toolRunner: (body: unknown) => {
          params.push(body);
          return {
            async *[Symbol.asyncIterator]() {
              for (const m of messages) {
                await Promise.resolve();
                yield m;
              }
            },
          };
        },
      },
    },
  } as unknown as AnthropicLike;
  return { sdk, params };
}

const request = {
  model: 'claude-sonnet-5',
  effort: 'high' as const,
  system: 'rules',
  prompt: 'task',
  tools: [
    defineTool({
      name: 'noop',
      description: 'does nothing',
      inputSchema: z.object({}),
      run: () => Promise.resolve(''),
    }),
  ],
  maxIterations: 10,
};

describe('AnthropicModelClient', () => {
  const limiter = () => new RateLimiter(1000, fakeClock());

  it('asks for adaptive thinking, the effort, and caches the instructions; no fallbacks on Sonnet', async () => {
    const { sdk, params } = stubSdk([message()]);
    const result = await new AnthropicModelClient(limiter(), sdk).runTools(
      request,
      new UsageMeter(),
    );

    expect(result.text).toBe('done');
    expect(params[0]).toMatchObject({
      model: 'claude-sonnet-5',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }],
      max_iterations: 10,
    });
    expect(params[0]).not.toHaveProperty('fallbacks');
  });

  it('turns on refusal fallbacks for Opus 5', async () => {
    const { sdk, params } = stubSdk([message()]);
    await new AnthropicModelClient(limiter(), sdk).runTools(
      { ...request, model: 'claude-opus-5' },
      new UsageMeter(),
    );

    expect(params[0]).toMatchObject({
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('meters every response and stops at the budget', async () => {
    const { sdk } = stubSdk([message(), message(), message()]);
    const meter = new UsageMeter(150);

    await expect(new AnthropicModelClient(limiter(), sdk).runTools(request, meter)).rejects.toThrow(
      BudgetExceededError,
    );
    expect(meter.totals()).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it('fails on a declined request', async () => {
    const { sdk } = stubSdk([
      message({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }),
    ]);

    await expect(
      new AnthropicModelClient(limiter(), sdk).runTools(request, new UsageMeter()),
    ).rejects.toThrow(ModelRefusalError);
  });

  it('explains missing credentials', async () => {
    const { sdk } = stubSdk([], () =>
      Promise.reject(new Error('Could not resolve authentication method')),
    );

    const check = new AnthropicModelClient(limiter(), sdk).check('claude-sonnet-5');

    await expect(check).rejects.toThrow(ModelAccessError);
    await expect(check).rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('explains rejected credentials and an unknown model', async () => {
    const rejected = stubSdk([], () =>
      Promise.reject(
        new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers()),
      ),
    );
    const missing = stubSdk([], () =>
      Promise.reject(new Anthropic.NotFoundError(404, {}, 'not found', new Headers())),
    );

    await expect(new AnthropicModelClient(limiter(), rejected.sdk).check('m')).rejects.toThrow(
      'rejected the credentials',
    );
    await expect(new AnthropicModelClient(limiter(), missing.sdk).check('m')).rejects.toThrow(
      'Model not found: m',
    );
  });
});

describe('AnthropicModelClient.listModels', () => {
  it('lists every page of models, newest first', async () => {
    const sdk = {
      models: {
        retrieve: () => Promise.resolve({}),
        async *list() {
          await Promise.resolve();
          yield { id: 'claude-haiku-4-5', created_at: '2025-10-01T00:00:00Z' };
          yield { id: 'claude-sonnet-5', created_at: '2026-05-01T00:00:00Z' };
        },
      },
    } as unknown as AnthropicLike;
    const client = new AnthropicModelClient(new RateLimiter(100), sdk);

    expect(await client.listModels()).toEqual([
      { name: 'claude-sonnet-5', modifiedAt: '2026-05-01T00:00:00Z' },
      { name: 'claude-haiku-4-5', modifiedAt: '2025-10-01T00:00:00Z' },
    ]);
  });

  it('reports rejected credentials as an access error', async () => {
    const sdk = {
      models: {
        retrieve: () => Promise.resolve({}),
        list() {
          throw new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers());
        },
      },
    } as unknown as AnthropicLike;

    await expect(new AnthropicModelClient(new RateLimiter(100), sdk).listModels()).rejects.toThrow(
      ModelAccessError,
    );
  });
});
