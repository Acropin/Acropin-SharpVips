/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ImageKit from '@imagekit/nodejs';
import { StorageError } from '../images/errors.js';
import type { IImageStorageProvider, StorageUploadResult } from './image-storage.js';

export interface ImageDeliveryOptions {
  width: number;
  height: number;
  format: 'auto' | 'webp' | 'avif' | 'jpeg' | 'png';
}

export function isImageKitConfigured(): boolean {
  return Boolean(process.env.IMAGEKIT_PRIVATE_KEY?.trim() &&
    process.env.IMAGEKIT_PUBLIC_KEY?.trim() &&
    process.env.IMAGEKIT_URL_ENDPOINT?.trim());
}

let sharedClient: ImageKit | null = null;

export function getImageKitClient(): ImageKit {
  if (!sharedClient) {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
    const publicKey = process.env.IMAGEKIT_PUBLIC_KEY?.trim();
    if (!privateKey || !publicKey) {
      throw new StorageError('ImageKit is not configured. Add its public key and private key to the server environment.');
    }
    sharedClient = new ImageKit({ privateKey });
  }
  return sharedClient;
}

export async function getImageKitFileDetails(fileId: string) {
  return getImageKitClient().files.get(fileId);
}

export async function deleteImageKitFile(fileId: string): Promise<void> {
  await getImageKitClient().files.delete(fileId);
}

export class ImageKitStorageProvider implements IImageStorageProvider {
  public name = 'imagekit';
  private client: ImageKit;
  private endpoint: string;

  constructor() {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
    const publicKey = process.env.IMAGEKIT_PUBLIC_KEY?.trim();
    const endpoint = process.env.IMAGEKIT_URL_ENDPOINT?.trim();
    if (!privateKey || !publicKey || !endpoint) {
      throw new StorageError('ImageKit is not configured. Add its public key, private key, and URL endpoint to the server environment.');
    }
    this.client = getImageKitClient();
    this.endpoint = endpoint.replace(/\/+$/u, '');
  }

  public async upload(
    key: string,
    buffer: Buffer,
    contentType = 'image/webp',
    metadata?: Record<string, string>
  ): Promise<StorageUploadResult> {
    const safeKey = key.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
    const separator = safeKey.lastIndexOf('/');
    const folder = separator < 0 ? '/' : `/${safeKey.slice(0, separator)}`;
    const fileName = separator < 0 ? safeKey : safeKey.slice(separator + 1);
    try {
      const uploaded = await this.client.files.upload({
        file: new Blob([new Uint8Array(buffer)], { type: contentType }),
        fileName,
        folder,
        isPrivateFile: true,
        useUniqueFileName: false,
        overwriteFile: false,
        tags: metadata ? Object.keys(metadata).slice(0, 10) : undefined,
        responseFields: ['isPrivateFile'],
      });
      if (!uploaded.filePath || !uploaded.fileId || uploaded.isPrivateFile === false) {
        if (uploaded.fileId) await this.client.files.delete(uploaded.fileId).catch(() => undefined);
        throw new Error('ImageKit did not confirm that the new image is private.');
      }
      const storedKey = uploaded.filePath.replace(/^\/+/, '');
      return {
        key: storedKey,
        url: this.getUrl(storedKey),
        byteSize: uploaded.size ?? buffer.length,
        contentType,
        providerId: uploaded.fileId,
      };
    } catch (error) {
      throw new StorageError(`Failed to upload image to ImageKit: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const url = this.signedUrl(key, undefined, 90);
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`ImageKit delivery returned HTTP ${response.status}.`);
      return {
        data: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
      };
    } catch (error) {
      throw new StorageError(`Failed to read image from ImageKit: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async exists(key: string): Promise<boolean> {
    return Boolean(await this.get(key));
  }

  public async delete(key: string, providerId?: string): Promise<void> {
    try {
      if (!providerId) {
        throw new Error(`ImageKit file ID is required to safely delete “${key}”.`);
      }
      await this.client.files.delete(providerId);
    } catch (error) {
      throw new StorageError(`Failed to delete image from ImageKit: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public getUrl(key: string): string {
    return `/api/images/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  public getDeliveryUrl(key: string, options: ImageDeliveryOptions, expiresIn: number): string {
    return this.signedUrl(key, options, expiresIn);
  }

  private signedUrl(key: string, options?: ImageDeliveryOptions, expiresIn = 90): string {
    const path = `/${key.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
    return this.client.helper.buildSrc({
      urlEndpoint: this.endpoint,
      src: path,
      signed: true,
      expiresIn,
      transformation: options ? [{
        width: options.width,
        height: options.height,
        crop: 'maintain_ratio',
        quality: 90,
        format: options.format === 'jpeg' ? 'jpg' : options.format,
      }] : undefined,
    });
  }
}
