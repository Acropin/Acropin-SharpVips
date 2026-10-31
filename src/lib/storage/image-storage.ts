/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { del, get, put } from '@vercel/blob';
import { StorageError } from '../images/errors.js';
import { getAppDataFile } from './data-directory.js';
import {
  isPersistentStorageWritable,
  markBlobStorageAvailable,
  markBlobStorageUnavailable,
} from './persistent-json.js';

export interface StorageUploadResult {
  key: string;
  url: string;
  byteSize: number;
  contentType: string;
}

export interface IImageStorageProvider {
  name: string;
  upload(
    key: string,
    buffer: Buffer,
    contentType?: string,
    metadata?: Record<string, string>
  ): Promise<StorageUploadResult>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

/**
 * Generates an immutable, versioned storage key following the pattern:
 * food-assets/{assetId}/v{version}/480.webp
 */
export function buildVersionedStorageKey(assetId: string, version = 1): string {
  const sanitizedId = assetId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `food-assets/${sanitizedId}/v${version}/480.webp`;
}

/**
 * Local Disk Provider:
 * Stores processed assets locally in a dedicated directory and serves them via `/api/images/*`.
 * Provides full, zero-credential local persistence and CDN-ready caching headers.
 */
export class LocalStorageProvider implements IImageStorageProvider {
  public name = 'local-disk';
  private baseDir: string;
  private publicPrefix: string;

  constructor(
    baseDir = getAppDataFile('assets'),
    publicPrefix = '/api/images',
    createBaseDirectory = true
  ) {
    this.baseDir = path.resolve(baseDir);
    this.publicPrefix = publicPrefix;

    if (createBaseDirectory && !fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveFilePath(key: string): string {
    const candidate = path.resolve(this.baseDir, key.replaceAll('\\', '/'));
    const relative = path.relative(this.baseDir, candidate);
    if (!relative || relative === '.' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new StorageError('Invalid storage key.');
    }
    return candidate;
  }

  public async upload(
    key: string,
    buffer: Buffer,
    contentType = 'image/webp'
  ): Promise<StorageUploadResult> {
    try {
      const filePath = this.resolveFilePath(key);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      await fs.promises.writeFile(filePath, buffer);

      return {
        key,
        url: this.getUrl(key),
        byteSize: buffer.length,
        contentType,
      };
    } catch (err) {
      throw new StorageError(
        `Failed to write asset to local storage: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const filePath = this.resolveFilePath(key);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const data = await fs.promises.readFile(filePath);
      const extension = path.extname(filePath).toLowerCase();
      return {
        data,
        contentType: extension === '.webp' ? 'image/webp'
          : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
            : extension === '.png' ? 'image/png'
              : extension === '.avif' ? 'image/avif'
                : extension === '.tif' || extension === '.tiff' ? 'image/tiff'
                  : extension === '.heif' || extension === '.heic' ? 'image/heif'
                    : 'application/octet-stream',
      };
    } catch (err) {
      throw new StorageError(
        `Failed to read asset from local storage: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public async exists(key: string): Promise<boolean> {
    const filePath = this.resolveFilePath(key);
    return fs.existsSync(filePath);
  }

  public async delete(key: string): Promise<void> {
    try {
      const filePath = this.resolveFilePath(key);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      throw new StorageError(
        `Failed to delete asset: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public getUrl(key: string): string {
    return `${this.publicPrefix}/${key}`;
  }
}

/** Vercel Blob adapter for durable image uploads in serverless deployments. */
export class VercelBlobStorageProvider implements IImageStorageProvider {
  public name = 'vercel-blob';
  // Vercel's function bundle is mounted at /var/task and is read-only. This
  // fallback exists only to read any bundled legacy assets, so never create
  // the directory while constructing the Blob provider.
  private localFallback = new LocalStorageProvider(
    getAppDataFile('assets'),
    '/api/images',
    false
  );

  public async upload(
    key: string,
    buffer: Buffer,
    contentType = 'image/webp'
  ): Promise<StorageUploadResult> {
    try {
      const blob = await put(key, buffer, {
        access: 'private',
        addRandomSuffix: true,
        contentType,
        cacheControlMaxAge: 31536000,
      });
      markBlobStorageAvailable();
      return {
        key: blob.pathname,
        url: this.getUrl(blob.pathname),
        byteSize: buffer.length,
        contentType,
      };
    } catch (err) {
      markBlobStorageUnavailable(err);
      throw new StorageError(`Failed to upload image to Vercel Blob: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    if (!isPersistentStorageWritable()) return this.localFallback.get(key);

    let blob: Awaited<ReturnType<typeof get>> | null = null;
    try {
      blob = await get(key, { access: 'private', useCache: false });
    } catch (error) {
      markBlobStorageUnavailable(error);
      return this.localFallback.get(key);
    }
    if (!blob) {
      markBlobStorageAvailable();
      return this.localFallback.get(key);
    }
    if (blob.statusCode !== 200 || !blob.stream) {
      markBlobStorageUnavailable(new Error(`Unexpected Blob response status ${blob.statusCode}.`));
      return this.localFallback.get(key);
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of blob.stream) {
        chunks.push(Buffer.from(chunk));
      }
      markBlobStorageAvailable();
      return {
        data: Buffer.concat(chunks),
        contentType: blob.blob.contentType || 'application/octet-stream',
      };
    } catch (error) {
      markBlobStorageUnavailable(error);
      return this.localFallback.get(key);
    }
  }

  public async exists(key: string): Promise<boolean> {
    return Boolean(await this.get(key));
  }

  public async delete(key: string): Promise<void> {
    try {
      await del(key);
      markBlobStorageAvailable();
    } catch (error) {
      markBlobStorageUnavailable(error);
      throw new StorageError(`Failed to delete image from Vercel Blob: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public getUrl(key: string): string {
    return `/api/images/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}

/** Allows bundled local images to be read while preventing unsafe serverless writes. */
class DeploymentReadOnlyStorageProvider extends LocalStorageProvider {
  public override name = 'deployment-read-only';

  constructor() {
    super(getAppDataFile('assets'), '/api/images', false);
  }

  public override async upload(
    _key: string,
    _buffer: Buffer,
    _contentType = 'image/webp'
  ): Promise<StorageUploadResult> {
    throw new StorageError('Image storage is not configured. Connect a private Vercel Blob store to enable uploads.');
  }

  public override async delete(_key: string): Promise<void> {
    throw new StorageError('Image storage is not configured. Connect a private Vercel Blob store to enable deletions.');
  }
}

// Global Singleton Provider Instance
let storageInstance: IImageStorageProvider | null = null;

export function getStorageProvider(): IImageStorageProvider {
  if (!storageInstance) {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      storageInstance = new VercelBlobStorageProvider();
    } else if (process.env.VERCEL === '1') {
      storageInstance = new DeploymentReadOnlyStorageProvider();
    } else {
      storageInstance = new LocalStorageProvider();
    }
  }
  return storageInstance;
}
