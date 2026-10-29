/** Resolve durable app data paths without allowing tests to mutate production data. */
import os from 'node:os';
import path from 'node:path';

export function getAppDataDirectory(): string {
  const configuredDirectory = process.env.ACROPIN_DATA_DIR?.trim();
  if (configuredDirectory) return path.resolve(configuredDirectory);

  if (process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), `acropin-sharpvips-test-${process.pid}`);
  }

  return path.resolve(process.cwd(), process.env.NODE_ENV === 'production' ? 'storage' : '.local-data');
}

export function getAppDataFile(...segments: string[]): string {
  return path.join(getAppDataDirectory(), ...segments);
}
