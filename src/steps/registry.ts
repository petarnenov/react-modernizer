import type { ModernizerConfig } from '../config/schema.js';
import { AnthropicModelClient } from '../model/anthropic.js';
import type { ModelClient } from '../model/client.js';
import { RateLimiter } from '../model/rate-limit.js';
import { createCharacterizeTestsStep } from './characterize-tests/step.js';
import { createClassToFunctionStep } from './class-to-function/step.js';
import type { StepRegistry } from './step.js';

/**
 * The steps that exist, built for a run's configuration. One model client — and so one rate limit — is shared by
 * every model step of the run.
 */
export function createBuiltInSteps(
  config: ModernizerConfig,
  model: ModelClient = new AnthropicModelClient(
    new RateLimiter(config.concurrency.requestsPerMinute),
  ),
): StepRegistry {
  return {
    'characterize-tests': createCharacterizeTestsStep(config, model),
    'class-to-function': createClassToFunctionStep(config, model),
  };
}
