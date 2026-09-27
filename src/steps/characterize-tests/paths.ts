import { posix } from 'node:path';

/** `src/Card.jsx` → `src/Card.characterization.test.jsx`: one predictable file per source file, never a user's test. */
export function characterizationTestPath(file: string): string {
  const ext = posix.extname(file);
  return posix.join(
    posix.dirname(file),
    `${posix.basename(file, ext)}.characterization.test${ext}`,
  );
}

/** The conventional colocated test, which the step may read but never change. */
export function existingTestPath(file: string): string {
  const ext = posix.extname(file);
  return posix.join(posix.dirname(file), `${posix.basename(file, ext)}.test${ext}`);
}

const TEST_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

/**
 * The file's tests, existing or not: its characterization test and a colocated `<name>.test.*` in any code extension
 * — after `js-to-ts` the file is `Card.tsx` while the user's `Card.test.js` keeps its extension.
 */
export function ownTestCandidates(file: string): string[] {
  const ext = posix.extname(file);
  const stem = posix.join(posix.dirname(file), posix.basename(file, ext));
  return [characterizationTestPath(file), ...TEST_EXTENSIONS.map((e) => `${stem}.test${e}`)];
}
