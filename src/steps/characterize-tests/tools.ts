import type { ModelTool } from '../../model/client.js';
import { shellQuote } from '../../run/gates.js';
import { readTools, reportBugTool, runTestsTool, writeOneFileTool } from '../shared/tools.js';
import type { BugReport } from '../step.js';

export { confine } from '../shared/tools.js';

export interface ToolOptions {
  /** The target's directory in the worktree. */
  cwd: string;
  /** The characterization test file, relative to `cwd` — the only file the model may write. */
  testPath: string;
  /** Command that runs the tests; `{testFile}` is replaced by the quoted test path. */
  testCommand: string;
  timeoutSeconds: number;
  report(bug: BugReport): void;
}

const REPORT_BUG =
  'Record a suspected bug in the file under test. The tests must still assert what the code does now; this is how ' +
  'a bug gets noticed without changing behaviour.';

export function createTools(options: ToolOptions): ModelTool<never>[] {
  const { cwd, testPath } = options;
  return [
    ...readTools(cwd),
    writeOneFileTool(
      cwd,
      testPath,
      'write_test_file',
      `Write the complete characterization test file (${testPath}), replacing what is there. This is the only file you can write.`,
    ),
    runTestsTool(
      cwd,
      options.testCommand.replaceAll('{testFile}', shellQuote(testPath)),
      options.timeoutSeconds,
      `Run the characterization tests (${testPath}) and get the output. Finish only when they pass.`,
    ),
    reportBugTool((bug) => {
      options.report(bug);
    }, REPORT_BUG),
  ];
}
