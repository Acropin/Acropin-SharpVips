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

export async function readPersistentJson<T>(blobPath: string, localPath: string): Promise<T | null> {
  if (isBlobStorageConfigured()) {
    const result = await get(blobPath, { access: 'private', useCache: false });
    if (result?.statusCode === 200 && result.stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
    }
  }

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
    await put(blobPath, JSON.stringify(value), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: 'application/json',
    });
    return;
  }

  if (process.env.VERCEL === '1' && process.env.NODE_ENV !== 'test') {
    throw new Error('Persistent storage is not configured. Connect a private Vercel Blob store to this project.');
  }

  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, JSON.stringify(value, null, 2), 'utf8');
}
