/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { upload } from '@imagekit/javascript';
import { apiFetch } from './api.js';

interface UploadAuthorization {
  uploadId: string;
  completionTicket: string;
  folder: string;
  fileName: string;
  token: string;
  signature: string;
  expire: number;
  publicKey: string;
}

interface ImageKitUploadResponse {
  fileId: string;
  filePath: string;
}

export type DirectImageUploadFields = Record<string, unknown>;

/** Upload the bytes directly to ImageKit, then ask Vercel to validate and register them. */
export async function uploadImageDirectToImageKit(
  file: File,
  fields: DirectImageUploadFields
): Promise<Response | null> {
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const authorizationResponse = await apiFetch('/api/images/upload/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type }),
  });

  const authorizationData = await authorizationResponse.json() as UploadAuthorization & { code?: string; error?: string };
  if (!authorizationResponse.ok) {
    if (authorizationResponse.status === 503 && authorizationData.code === 'IMAGEKIT_NOT_CONFIGURED') return null;
    throw new Error(authorizationData.error || 'Could not prepare the secure image upload.');
  }

  const image = await upload({
    file,
    fileName: authorizationData.fileName,
    folder: authorizationData.folder,
    token: authorizationData.token,
    signature: authorizationData.signature,
    expire: authorizationData.expire,
    publicKey: authorizationData.publicKey,
    isPrivateFile: true,
    checks: '"file.size" <= 15728640 AND "file.mime" IN ["image/jpeg","image/png","image/webp","image/avif","image/tiff","image/heic","image/heif"]',
    useUniqueFileName: false,
    overwriteFile: false,
  }) as ImageKitUploadResponse;

  return apiFetch('/api/images/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...fields,
      imageKitUpload: {
        uploadId: authorizationData.uploadId,
        completionTicket: authorizationData.completionTicket,
        fileId: image.fileId,
        filePath: image.filePath,
      },
    }),
  });
}
