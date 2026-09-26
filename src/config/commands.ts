import { shellQuote } from '../run/gates.js';

/** Replaces `{cache}` with the worker's cache directory, quoted; the step's commands use it like the gates do. */
export function withCache(command: string, cache: string | undefined): string {
  return cache === undefined ? command : command.replaceAll('{cache}', shellQuote(cache));
}

/** Replaces `{testRunner}` in a configured command, so one setting decides how every command runs tests. */
export function withTestRunner(command: string, testRunner: string): string {
  return command.replaceAll('{testRunner}', testRunner);
}
