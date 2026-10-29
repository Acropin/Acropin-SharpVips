import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VercelBlobStorageProvider } from './image-storage.js';

test('Vercel Blob provider does not create local directories in the deployment bundle', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'acropin-blob-storage-'));
  const configuredDataDirectory = path.join(tempDirectory, 'runtime-data');
  const originalDataDirectory = process.env.ACROPIN_DATA_DIR;

  try {
    process.env.ACROPIN_DATA_DIR = configuredDataDirectory;
    new VercelBlobStorageProvider();

    assert.equal(
      fs.existsSync(path.join(configuredDataDirectory, 'assets')),
      false,
      'the Blob provider fallback must not create a local assets directory'
    );
  } finally {
    if (originalDataDirectory === undefined) delete process.env.ACROPIN_DATA_DIR;
    else process.env.ACROPIN_DATA_DIR = originalDataDirectory;
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
