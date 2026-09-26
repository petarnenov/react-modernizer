import type { ModernizerConfig } from '../config/schema.js';
import { AnthropicModelClient } from '../model/anthropic.js';
import type { ModelClient } from '../model/client.js';
import { OllamaModelClient } from '../model/ollama.js';
import { RateLimiter } from '../model/rate-limit.js';
import { createAnalyzeStep } from './analyze/step.js';
import { createCharacterizeTestsStep } from './characterize-tests/step.js';
import { createClassToFunctionStep } from './class-to-function/step.js';
import { createJsToTsStep } from './js-to-ts/step.js';
import { createSimplifyStep } from './simplify/step.js';
import type { StepRegistry } from './step.js';

/** The model client for the configured provider, with one rate limit for the whole run. */
export function createModelClient(config: ModernizerConfig): ModelClient {
  const limiter = new RateLimiter(config.concurrency.requestsPerMinute);
  return config.model.provider === 'ollama'
    ? new OllamaModelClient(limiter, {
        baseUrl: config.model.baseUrl,
        apiKeyEnv: config.model.apiKeyEnv,
      })
    : new AnthropicModelClient(limiter);
}

/**
 * The steps that exist, built for a run's configuration. One model client — and so one rate limit — is shared by
 * every model step of the run.
 */
export function createBuiltInSteps(
  config: ModernizerConfig,
  model: ModelClient = createModelClient(config),
): StepRegistry {
  return {
    analyze: createAnalyzeStep(config, model),
    'characterize-tests': createCharacterizeTestsStep(config, model),
    'class-to-function': createClassToFunctionStep(config, model),
    'js-to-ts': createJsToTsStep(config, model),
    simplify: createSimplifyStep(config, model),
  };
}
