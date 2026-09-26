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
