export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * At most `perMinute` acquisitions in any 60-second window, shared by every worker. Over the limit, `acquire` waits
 * for the oldest request to leave the window; it never fails.
 */
export class RateLimiter {
  private readonly starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly perMinute: number,
    private readonly clock: Clock = systemClock,
  ) {
    if (!Number.isInteger(perMinute) || perMinute < 1) {
      throw new RangeError(`perMinute must be a positive integer, got ${String(perMinute)}`);
    }
  }

  acquire(): Promise<void> {
    // Serialised, so concurrent callers are admitted in order and never both take the last slot.
    const turn = this.queue.then(() => this.take());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async take(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      while (this.starts.length > 0 && now - (this.starts[0] ?? 0) >= 60_000) {
        this.starts.shift();
      }
      if (this.starts.length < this.perMinute) {
        this.starts.push(now);
        return;
      }
      await this.clock.sleep(60_000 - (now - (this.starts[0] ?? now)));
    }
  }
}
