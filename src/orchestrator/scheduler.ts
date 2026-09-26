export type Outcome = 'done' | 'failed';

/**
 * Hands out files whose dependencies are settled, leaves first, so a file is migrated after the files it imports
 * and their types are there to use. A failed dependency counts as settled: it stays JavaScript, and its dependents
 * are still worth migrating.
 *
 * The same scheduler serves one worker or many — concurrency is only how many files are taken at once.
 */
export class Scheduler {
  private readonly pending = new Map<string, Set<string>>();
  private readonly dependents = new Map<string, string[]>();
  private readonly running = new Set<string>();
  private readonly settled = new Map<string, Outcome>();

  /** @param graph each file mapped to the files it imports; imports outside the graph are ignored. */
  constructor(graph: ReadonlyMap<string, readonly string[]>) {
    for (const [file, imports] of graph) {
      const deps = new Set(imports.filter((dep) => dep !== file && graph.has(dep)));
      this.pending.set(file, deps);
      for (const dep of deps) {
        const list = this.dependents.get(dep) ?? [];
        list.push(file);
        this.dependents.set(dep, list);
      }
    }
  }

  /** The next file to work on, or undefined when none is ready right now. */
  next(): string | undefined {
    let file = this.firstReady();
    if (file === undefined && this.running.size === 0) {
      // Nothing ready and nothing that could make something ready: only an import cycle is left. Break it at the
      // file with the fewest unsettled imports.
      file = this.cycleBreaker();
    }
    if (file !== undefined) {
      this.pending.delete(file);
      this.running.add(file);
    }
    return file;
  }

  complete(file: string, outcome: Outcome): void {
    if (!this.running.delete(file)) {
      throw new Error(`Not running: ${file}`);
    }
    this.settled.set(file, outcome);
    for (const dependent of this.dependents.get(file) ?? []) {
      this.pending.get(dependent)?.delete(file);
    }
  }

  get isFinished(): boolean {
    return this.pending.size === 0 && this.running.size === 0;
  }

  get results(): ReadonlyMap<string, Outcome> {
    return this.settled;
  }

  private firstReady(): string | undefined {
    for (const [file, deps] of this.pending) {
      if (deps.size === 0) {
        return file;
      }
    }
    return undefined;
  }

  private cycleBreaker(): string | undefined {
    let best: string | undefined;
    let fewest = Infinity;
    for (const [file, deps] of this.pending) {
      if (deps.size < fewest) {
        best = file;
        fewest = deps.size;
      }
    }
    return best;
  }
}

/**
 * Runs `work` over every file with at most `workers` in flight. A thrown error counts as a failed file, never as a
 * failed run: one broken file must not stop the other thousands.
 */
export async function runPool(
  scheduler: Scheduler,
  workers: number,
  work: (file: string) => Promise<Outcome>,
): Promise<ReadonlyMap<string, Outcome>> {
  if (!Number.isInteger(workers) || workers < 1) {
    throw new RangeError(`workers must be a positive integer, got ${String(workers)}`);
  }
  const inFlight = new Set<Promise<void>>();

  const start = (file: string): void => {
    const task = work(file)
      .catch((): Outcome => 'failed')
      .then((outcome) => {
        scheduler.complete(file, outcome);
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  };

  while (!scheduler.isFinished) {
    let file: string | undefined;
    while (inFlight.size < workers && (file = scheduler.next()) !== undefined) {
      start(file);
    }
    if (inFlight.size === 0) {
      break;
    }
    await Promise.race(inFlight);
  }
  return scheduler.results;
}
