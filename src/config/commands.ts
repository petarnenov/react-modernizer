/** Replaces `{testRunner}` in a configured command, so one setting decides how every command runs tests. */
export function withTestRunner(command: string, testRunner: string): string {
  return command.replaceAll('{testRunner}', testRunner);
}
