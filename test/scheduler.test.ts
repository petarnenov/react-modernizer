import { describe, expect, it } from 'vitest';
import { runPool, Scheduler, type Outcome } from '../src/orchestrator/scheduler.js';

const graph = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe('Scheduler', () => {
  it('hands out leaves before the files that import them', () => {
    const s = new Scheduler(graph({ page: ['card'], card: ['api'], api: [] }));
    const order: string[] = [];
    for (let file = s.next(); file !== undefined; file = s.next()) {
      order.push(file);
      s.complete(file, 'done');
    }

    expect(order).toEqual(['api', 'card', 'page']);
    expect(s.isFinished).toBe(true);
  });

  it('waits while a dependency is still running', () => {
    const s = new Scheduler(graph({ card: ['api'], api: [] }));

    expect(s.next()).toBe('api');
    expect(s.next()).toBeUndefined();
    s.complete('api', 'done');
    expect(s.next()).toBe('card');
  });

  it('treats a failed dependency as settled', () => {
    const s = new Scheduler(graph({ card: ['api'], api: [] }));
    s.complete(s.next() ?? '', 'failed');

    expect(s.next()).toBe('card');
  });

  it('ignores imports outside the graph and self-imports', () => {
    const s = new Scheduler(graph({ card: ['react', 'card'] }));

    expect(s.next()).toBe('card');
  });

  it('breaks an import cycle instead of stalling', () => {
    const s = new Scheduler(graph({ a: ['b'], b: ['a'] }));
    const first = s.next();

    expect(first).toBeDefined();
    s.complete(first ?? '', 'done');
    expect(s.next()).toBeDefined();
  });
});

describe('runPool', () => {
  it('never exceeds the worker limit and processes every file', async () => {
    const files = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${String(i)}`, []]));
    let active = 0;
    let peak = 0;

    const results = await runPool(new Scheduler(graph(files)), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return 'done';
    });

    expect(results.size).toBe(20);
    expect(peak).toBe(3);
  });

  it('runs strictly one at a time with one worker', async () => {
    let active = 0;
    let peak = 0;
    await runPool(new Scheduler(graph({ a: [], b: [], c: [] })), 1, async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return 'done';
    });

    expect(peak).toBe(1);
  });

  it('records a thrown error as a failed file and carries on', async () => {
    const results = await runPool(
      new Scheduler(graph({ bad: [], good: ['bad'] })),
      2,
      (file): Promise<Outcome> =>
        file === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve('done'),
    );

    expect(Object.fromEntries(results)).toEqual({ bad: 'failed', good: 'done' });
  });

  it('rejects a non-positive worker count', async () => {
    await expect(
      runPool(new Scheduler(new Map()), 0, () => Promise.resolve('done')),
    ).rejects.toThrow(RangeError);
  });
});
