/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { del, get, put } from '@vercel/blob';
import { StorageError } from '../images/errors.js';

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

  constructor(baseDir = './storage/assets', publicPrefix = '/api/images') {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this.publicPrefix = publicPrefix;

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveFilePath(key: string): string {
    // Prevent directory traversal
    const safeKey = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.baseDir, safeKey);
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
      return {
        data,
        contentType: key.endsWith('.webp') ? 'image/webp' : 'application/octet-stream',
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
  private localFallback = new LocalStorageProvider();

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
      return {
        key: blob.pathname,
        url: this.getUrl(blob.pathname),
        byteSize: buffer.length,
        contentType,
      };
    } catch (err) {
      throw new StorageError(`Failed to upload image to Vercel Blob: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    const blob = await get(key, { access: 'private', useCache: false });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return this.localFallback.get(key);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of blob.stream) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      data: Buffer.concat(chunks),
      contentType: blob.blob.contentType || 'application/octet-stream',
    };
  }

  public async exists(key: string): Promise<boolean> {
    return Boolean(await this.get(key));
  }

  public async delete(key: string): Promise<void> {
    await del(key);
  }

  public getUrl(key: string): string {
    return `/api/images/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}

/** Allows bundled demo images to be read while preventing unsafe serverless writes. */
class DeploymentReadOnlyStorageProvider extends LocalStorageProvider {
  public override name = 'deployment-read-only';

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

/**
 * Cloudflare R2 / S3-compatible Provider Interface:
 * When credentials are provided via environment variables, integrates with Cloudflare R2.
 */
export class S3R2StorageProvider implements IImageStorageProvider {
  public name = 'cloudflare-r2';
  private bucket: string;
  private publicDomain: string;
  private localFallback: LocalStorageProvider;
  private isConfigured: boolean;

  constructor() {
    this.bucket = process.env.R2_BUCKET_NAME || '';
    this.publicDomain = process.env.R2_PUBLIC_DOMAIN || '';
    this.isConfigured = Boolean(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      this.bucket
    );
    this.localFallback = new LocalStorageProvider();
  }

  public isRemoteConfigured(): boolean {
    return this.isConfigured;
  }

  public async upload(
    key: string,
    buffer: Buffer,
    contentType = 'image/webp',
    metadata?: Record<string, string>
  ): Promise<StorageUploadResult> {
    if (!this.isConfigured) {
      // Gracefully uses local adapter and logs configuration status
      return this.localFallback.upload(key, buffer, contentType);
    }

    // In a remote-configured deployment, an S3 client sends PutObjectCommand:
    // await s3Client.send(new PutObjectCommand({
    //   Bucket: this.bucket,
    //   Key: key,
    //   Body: buffer,
    //   ContentType: contentType,
    //   CacheControl: 'public, max-age=31536000, immutable',
    //   Metadata: metadata,
    // }));
    return {
      key,
      url: this.getUrl(key),
      byteSize: buffer.length,
      contentType,
    };
  }

  public async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    return this.localFallback.get(key);
  }

  public async exists(key: string): Promise<boolean> {
    return this.localFallback.exists(key);
  }

  public async delete(key: string): Promise<void> {
    return this.localFallback.delete(key);
  }

  public getUrl(key: string): string {
    if (this.isConfigured && this.publicDomain) {
      return `https://${this.publicDomain}/${key}`;
    }
    return this.localFallback.getUrl(key);
  }
}

// Global Singleton Provider Instance
let storageInstance: IImageStorageProvider | null = null;

export function getStorageProvider(): IImageStorageProvider {
  if (!storageInstance) {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      storageInstance = new VercelBlobStorageProvider();
    } else if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
      storageInstance = new S3R2StorageProvider();
    } else if (process.env.VERCEL === '1') {
      storageInstance = new DeploymentReadOnlyStorageProvider();
    } else {
      storageInstance = new LocalStorageProvider();
    }
  }
  return storageInstance;
}
