import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.js';
import { AnthropicModelClient } from '../src/model/anthropic.js';
import { createModelClient } from '../src/steps/registry.js';
import { z } from 'zod';
import { defineTool, ModelAccessError } from '../src/model/client.js';
import { OllamaModelClient, thinkLevel, type FetchLike } from '../src/model/ollama.js';
import { RateLimiter, type Clock } from '../src/model/rate-limit.js';
import { BudgetExceededError, UsageMeter } from '../src/model/usage.js';
import type { ToolRunRequest } from '../src/model/client.js';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/** A server that answers from a list, in order, and records what it was sent. */
function server(answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetch: FetchLike = (url, init) => {
    sent.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body:
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    });
    const next = answers.shift();
    if (next === undefined) throw new Error('no more answers');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetch, sent };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const reply = (message: object, usage = { prompt_eval_count: 100, eval_count: 10 }) =>
  json({ message: { role: 'assistant', content: '', ...message }, done_reason: 'stop', ...usage });

const clock = (): Clock & { slept: number[] } => {
  const slept: number[] = [];
  return {
    slept,
    now: () => 0,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
};

function client(
  answers: (Response | Error)[],
  { key = 'k', baseUrl = 'https://ollama.com' }: { key?: string; baseUrl?: string } = {},
) {
  const s = server(answers);
  const c = clock();
  const ollama = new OllamaModelClient(new RateLimiter(1000), {
    baseUrl,
    apiKeyEnv: 'OLLAMA_API_KEY',
    env: key === '' ? {} : { OLLAMA_API_KEY: key },
    fetch: s.fetch,
    clock: c,
  });
  return { ollama, sent: s.sent, slept: c.slept };
}

const ran: unknown[] = [];
const reportBug = defineTool({
  name: 'report_bug',
  description: 'Record a bug',
  inputSchema: z.object({ reason: z.string().min(1), line: z.number().int().optional() }),
  run: (input) => {
    ran.push(input);
    return Promise.resolve('recorded');
  },
});

const request = (over: Partial<ToolRunRequest> = {}): ToolRunRequest => ({
  model: 'gpt-oss:120b',
  effort: 'high',
  system: 'You analyse.',
  prompt: 'Analyse src/a.js',
  tools: [reportBug],
  maxIterations: 10,
  ...over,
});

describe('thinkLevel', () => {
  it('passes low to high through and caps the rest at high', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max'].map((e) => thinkLevel(e as never))).toEqual([
      'low',
      'medium',
      'high',
      'high',
      'high',
    ]);
  });
});

describe('OllamaModelClient.check', () => {
  it('passes when the server lists the model, sending the key', async () => {
    const { ollama, sent } = client([json({ models: [{ name: 'gpt-oss:120b' }] })]);

    await ollama.check('gpt-oss:120b');

    expect(sent[0]).toMatchObject({
      url: 'https://ollama.com/api/tags',
      method: 'GET',
      headers: { authorization: 'Bearer k' },
    });
  });

  it('names OLLAMA_API_KEY when Ollama Cloud has no key', async () => {
    const { ollama, sent } = client([], { key: '' });

    await expect(ollama.check('gpt-oss:120b')).rejects.toThrow(ModelAccessError);
    await expect(ollama.check('gpt-oss:120b')).rejects.toThrow('OLLAMA_API_KEY');
    expect(sent).toHaveLength(0);
  });

  it('needs no key for a local server', async () => {
    const { ollama, sent } = client([json({ models: [{ name: 'gpt-oss:120b' }] })], {
      key: '',
      baseUrl: 'http://localhost:11434/',
    });

    await ollama.check('gpt-oss:120b');

    expect(sent[0]?.url).toBe('http://localhost:11434/api/tags');
    expect(sent[0]?.headers.authorization).toBeUndefined();
  });

  it('reports a rejected key without retrying', async () => {
    const { ollama, sent } = client([new Response('unauthorized', { status: 401 })]);

    await expect(ollama.check('gpt-oss:120b')).rejects.toThrow(
      /rejected the credentials.*OLLAMA_API_KEY/,
    );
    expect(sent).toHaveLength(1);
  });

  it('names a model the server does not list', async () => {
    const { ollama } = client([json({ models: [{ name: 'gpt-oss:20b' }] })]);

    await expect(ollama.check('gpt-oss:120b')).rejects.toThrow(
      'Model not found on https://ollama.com: gpt-oss:120b (available: gpt-oss:20b)',
    );
  });
});

describe('OllamaModelClient.runTools', () => {
  it('runs tool calls until the model answers without tools, and records usage', async () => {
    ran.length = 0;
    const { ollama, sent } = client([
      reply({
        thinking: 'the interval leaks',
        tool_calls: [{ function: { name: 'report_bug', arguments: { reason: 'leak', line: 5 } } }],
      }),
      reply({ content: ' done ' }),
    ]);
    const meter = new UsageMeter();

    const result = await ollama.runTools(request({ effort: 'max' }), meter);

    expect(result.text).toBe('done');
    expect(ran).toEqual([{ reason: 'leak', line: 5 }]);
    expect(meter.totals()).toEqual({ inputTokens: 200, outputTokens: 20 });
    expect(sent[0]?.url).toBe('https://ollama.com/api/chat');
    expect(sent[0]?.body).toMatchObject({ model: 'gpt-oss:120b', stream: false, think: 'high' });
    expect(sent[0]?.body?.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'report_bug',
          description: 'Record a bug',
          parameters: expect.objectContaining({
            type: 'object',
            required: ['reason'],
          }) as unknown,
        },
      },
    ]);
    // The second request carries the assistant turn (thinking included) and the tool result.
    expect((sent[1]?.body?.messages as object[]).slice(2)).toEqual([
      {
        role: 'assistant',
        content: '',
        thinking: 'the interval leaks',
        tool_calls: [{ function: { name: 'report_bug', arguments: { reason: 'leak', line: 5 } } }],
      },
      { role: 'tool', tool_name: 'report_bug', content: 'recorded' },
    ]);
  });

  it('returns invalid tool input to the model without running the tool', async () => {
    ran.length = 0;
    const { ollama, sent } = client([
      reply({ tool_calls: [{ function: { name: 'report_bug', arguments: { line: 3 } } }] }),
      reply({ content: 'ok' }),
    ]);

    await ollama.runTools(request(), new UsageMeter());

    expect(ran).toEqual([]);
    const toolMessage = (sent[1]?.body?.messages as { role: string; content: string }[]).at(-1);
    expect(toolMessage?.content).toMatch(/^Error: invalid input for report_bug/);
    expect(toolMessage?.content).toContain('reason');
  });

  it('accepts arguments sent as a JSON string', async () => {
    ran.length = 0;
    const { ollama } = client([
      reply({ tool_calls: [{ function: { name: 'report_bug', arguments: '{"reason":"x"}' } }] }),
      reply({ content: 'ok' }),
    ]);

    await ollama.runTools(request(), new UsageMeter());

    expect(ran).toEqual([{ reason: 'x' }]);
  });

  it('makes no request once the budget is used up', async () => {
    const { ollama, sent } = client([
      reply(
        { tool_calls: [{ function: { name: 'report_bug', arguments: { reason: 'x' } } }] },
        { prompt_eval_count: 900, eval_count: 200 },
      ),
    ]);

    await expect(ollama.runTools(request(), new UsageMeter(1000))).rejects.toThrow(
      BudgetExceededError,
    );
    expect(sent).toHaveLength(1);
  });

  it('fails a response cut off at the output length', async () => {
    const { ollama } = client([
      json({ message: { role: 'assistant', content: 'partial' }, done_reason: 'length' }),
    ]);

    await expect(ollama.runTools(request(), new UsageMeter())).rejects.toThrow('cut off');
  });

  it('retries rate-limit, server and network errors twice, then fails', async () => {
    const { ollama, slept } = client([
      new Response('slow down', { status: 429 }),
      new TypeError('fetch failed'),
      reply({ content: 'ok' }),
    ]);

    expect((await ollama.runTools(request(), new UsageMeter())).text).toBe('ok');
    expect(slept).toEqual([2_000, 8_000]);

    const failing = client([
      new Response('down', { status: 503 }),
      new Response('down', { status: 503 }),
      new Response('down', { status: 503 }),
    ]);
    await expect(failing.ollama.runTools(request(), new UsageMeter())).rejects.toThrow(
      'Ollama answered 503',
    );
  });

  it('stops after maxIterations requests', async () => {
    const call = () =>
      reply({ tool_calls: [{ function: { name: 'report_bug', arguments: { reason: 'x' } } }] });
    const { ollama, sent } = client([call(), call(), call()]);

    await ollama.runTools(request({ maxIterations: 2 }), new UsageMeter());

    expect(sent).toHaveLength(2);
  });
});

describe('createModelClient', () => {
  it('picks the client for the configured provider', () => {
    expect(
      createModelClient(parseConfig({ target: '.', model: { provider: 'ollama' } })),
    ).toBeInstanceOf(OllamaModelClient);
    expect(createModelClient(parseConfig({ target: '.' }))).toBeInstanceOf(AnthropicModelClient);
  });
});
