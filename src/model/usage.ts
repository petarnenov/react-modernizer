export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';
}

/** Token usage as the API reports it for one response. */
export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Counts the tokens one file's steps use, across every call and attempt, against `budget.maxTokensPerFile`. Cached
 * input counts too: the budget is about how much a file consumes, not what it costs.
 */
export class UsageMeter {
  inputTokens = 0;
  outputTokens = 0;

  constructor(readonly limit?: number) {}

  get total(): number {
    return this.inputTokens + this.outputTokens;
  }

  get exhausted(): boolean {
    return this.limit !== undefined && this.total >= this.limit;
  }

  add(usage: ResponseUsage): void {
    this.inputTokens +=
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    this.outputTokens += usage.output_tokens;
  }

  /** Throws once the budget is used up, so a step stops before its next request. */
  assertWithinBudget(): void {
    if (this.exhausted) {
      throw new BudgetExceededError(
        `token budget exhausted: ${String(this.total)} of ${String(this.limit)} (budget.maxTokensPerFile)`,
      );
    }
  }

  totals(): UsageTotals {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}
