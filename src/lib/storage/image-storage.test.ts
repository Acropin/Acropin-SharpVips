import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VercelBlobStorageProvider } from './image-storage.js';
import { isBlobStorageConfigured } from './persistent-json.js';

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


test('Blob configuration recognizes a connected Vercel OIDC store and static tokens', () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    blobToken: process.env.BLOB_READ_WRITE_TOKEN,
    storeId: process.env.BLOB_STORE_ID,
    oidcToken: process.env.VERCEL_OIDC_TOKEN,
  };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_STORE_ID = 'store_test';
    process.env.VERCEL_OIDC_TOKEN = 'oidc_test';
    assert.equal(isBlobStorageConfigured(), true);

    delete process.env.VERCEL_OIDC_TOKEN;
    assert.equal(isBlobStorageConfigured(), false);

    process.env.BLOB_READ_WRITE_TOKEN = 'static_test';
    assert.equal(isBlobStorageConfigured(), true);
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
    if (original.blobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = original.blobToken;
    if (original.storeId === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = original.storeId;
    if (original.oidcToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = original.oidcToken;
  }
});
