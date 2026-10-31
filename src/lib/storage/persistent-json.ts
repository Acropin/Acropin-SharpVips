/**
 * Small shared JSON persistence adapter for local development and Vercel.
 * Vercel Functions cannot persist writes to the deployed filesystem, so a
 * connected private Blob store is required for production mutations.
 */

import { get, put } from '@vercel/blob';
import fs from 'node:fs/promises';
import path from 'node:path';

export function isBlobStorageConfigured(): boolean {
  return process.env.NODE_ENV !== 'test' && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export interface PersistentStorageHealth {
  mode: 'local' | 'blob' | 'fallback' | 'unconfigured';
  configured: boolean;
  available: boolean;
  writable: boolean;
}

let blobStorageState: 'unknown' | 'available' | 'unavailable' = 'unknown';
let blobFailureCount = 0;
let retryBlobAt = 0;
let lastBlobFailureLogAt = 0;

export function markBlobStorageAvailable(): void {
  blobStorageState = 'available';
  blobFailureCount = 0;
  retryBlobAt = 0;
}

export function markBlobStorageUnavailable(error?: unknown): void {
  blobStorageState = 'unavailable';
  blobFailureCount += 1;
  const cooldownMs = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(blobFailureCount - 1, 4));
  retryBlobAt = Date.now() + cooldownMs;

  // Keep function logs useful during an outage without logging credentials or
  // emitting the same Blob failure for every read in a warm server instance.
  if (Date.now() - lastBlobFailureLogAt > 30_000) {
    lastBlobFailureLogAt = Date.now();
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Persistent Blob storage is unavailable (${errorName}); using the bundled data snapshot.`);
  }
}

export function getPersistentStorageHealth(): PersistentStorageHealth {
  const configured = isBlobStorageConfigured();
  if (!configured) {
    const writable = process.env.VERCEL !== '1' || process.env.NODE_ENV === 'test';
    return {
      mode: writable ? 'local' : 'unconfigured',
      configured: false,
      available: writable,
      writable,
    };
  }

  const available = blobStorageState === 'available';
  return {
    mode: available ? 'blob' : 'fallback',
    configured: true,
    available,
    writable: available,
  };
}

export function isPersistentStorageWritable(): boolean {
  return getPersistentStorageHealth().writable;
}

export async function readPersistentJson<T>(blobPath: string, localPath: string): Promise<T | null> {
  if (isBlobStorageConfigured()) {
    if (blobStorageState !== 'unavailable' || Date.now() >= retryBlobAt) {
      let result: Awaited<ReturnType<typeof get>> | null = null;
      let readFailed = false;
      try {
        result = await get(blobPath, { access: 'private', useCache: false });
      } catch (error) {
        readFailed = true;
        markBlobStorageUnavailable(error);
      }

      if (result?.statusCode === 200 && result.stream) {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of result.stream) {
            chunks.push(Buffer.from(chunk));
          }
          markBlobStorageAvailable();
          // Invalid persisted JSON remains a hard data error. Never hide it by
          // silently replacing it with an older packaged snapshot.
          return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
        } catch (error) {
          if (error instanceof SyntaxError) throw error;
          markBlobStorageUnavailable(error);
        }
      } else if (result === null && !readFailed) {
        // A null response is a normal missing-object result; the Blob service
        // itself is reachable and the bundled/local file may provide a seed.
        markBlobStorageAvailable();
      } else if (result) {
        markBlobStorageUnavailable(new Error(`Unexpected Blob response status ${result.statusCode}.`));
      }
    }
  }

  return readLocalJson<T>(localPath);
}

async function readLocalJson<T>(localPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(localPath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writePersistentJson<T>(blobPath: string, localPath: string, value: T): Promise<void> {
  if (isBlobStorageConfigured()) {
    try {
      await put(blobPath, JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        contentType: 'application/json',
      });
      markBlobStorageAvailable();
      return;
    } catch (error) {
      markBlobStorageUnavailable(error);
      throw error;
    }
  }

  if (process.env.VERCEL === '1' && process.env.NODE_ENV !== 'test') {
    throw new Error('Persistent storage is not configured. Connect a private Vercel Blob store to this project.');
  }

  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, JSON.stringify(value, null, 2), 'utf8');
}
