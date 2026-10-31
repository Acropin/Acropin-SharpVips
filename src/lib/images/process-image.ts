/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { ImageValidationError, ImageTooSmallError, ImageProcessingError } from './errors.js';
import { computePerceptualHash } from './perceptual-hash.js';
import type {
  FocalPoint,
  ImageProcessingOptions,
  ProcessedImageOnDemandResult,
  ProcessedImageResult,
} from './types.js';

// Safety limits. Variants use these values as their maximum edge, not a forced
// square canvas. The original photo is never cropped or enlarged.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_DIMENSION = 8000;
export const MAX_PIXELS = 30_000_000;
export const MIN_SOURCE_DIMENSION = 300;
export const MIN_PRIMARY_EDGE = 480;
export const SUPPORTED_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff', 'heif']);
export const DEFAULT_WEBP_QUALITY = 95;
export const THUMBNAIL_WEBP_QUALITY = 88;

/**
 * Validate image buffer headers, size, dimensions, and pixel counts.
 * We require enough source pixels for a 480px primary without upscaling.
 */
export async function validateImageBuffer(buffer: Buffer): Promise<{
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  orientation?: number;
}> {
  if (!buffer || buffer.length === 0) {
    throw new ImageValidationError('Image buffer is empty.', 'EMPTY_BUFFER');
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ImageValidationError(
      `File size (${(buffer.length / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed limit of 15 MB.`,
      'FILE_TOO_LARGE'
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'error' }).metadata();
  } catch (err) {
    throw new ImageValidationError(
      `Malformed or corrupted image file: ${err instanceof Error ? err.message : String(err)}`,
      'CORRUPT_OR_UNSUPPORTED'
    );
  }

  const format = (metadata.format || '').toLowerCase();
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new ImageValidationError(
      `Unsupported format "${format}". Supported formats are: ${Array.from(SUPPORTED_FORMATS).join(', ')}.`,
      'UNSUPPORTED_FORMAT'
    );
  }

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width <= 0 || height <= 0) {
    throw new ImageValidationError('Could not determine valid image dimensions.', 'INVALID_DIMENSIONS');
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new ImageValidationError(
      `Image dimensions (${width}x${height}) exceed maximum allowed dimension limit of ${MAX_DIMENSION}px.`,
      'DIMENSIONS_EXCEEDED'
    );
  }

  const totalPixels = width * height;
  if (totalPixels > MAX_PIXELS) {
    throw new ImageValidationError(
      `Image pixel count (${totalPixels.toLocaleString()}) exceeds safety limit of ${MAX_PIXELS.toLocaleString()} pixels.`,
      'PIXELS_EXCEEDED'
    );
  }
  if (Math.min(width, height) < MIN_SOURCE_DIMENSION) {
    throw new ImageTooSmallError(
      `Image dimensions (${width}x${height}) are too small. Both source edges must be at least ${MIN_SOURCE_DIMENSION}px.`,
      { width, height, minRequired: MIN_SOURCE_DIMENSION }
    );
  }

  const orientedMaxEdge = Math.max(width, height);
  if (orientedMaxEdge < MIN_PRIMARY_EDGE) {
    throw new ImageTooSmallError(
      `Image dimensions (${width}x${height}) cannot provide a ${MIN_PRIMARY_EDGE}px primary image without upscaling. Use a higher-resolution source.`,
      { width, height, minRequired: MIN_PRIMARY_EDGE }
    );
  }

  return { width, height, format, hasAlpha: Boolean(metadata.hasAlpha), orientation: metadata.orientation };
}

interface EncodedVariant {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Encode a variant directly from the original, preserving its full frame. */
async function encodeVariant(
  inputBuffer: Buffer,
  maxEdge: number,
  quality: number,
  effort: number
): Promise<EncodedVariant> {
  const { data, info } = await sharp(inputBuffer, { failOn: 'error' })
    .rotate()
    .resize(maxEdge, maxEdge, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .toColorspace('srgb')
    .webp({ quality, effort, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height || info.width > maxEdge || info.height > maxEdge) {
    throw new ImageProcessingError(`The ${maxEdge}px variant has invalid output dimensions.`);
  }
  return { buffer: data, width: info.width, height: info.height };
}

/**
 * Process an image into quality-first WebP variants. Each numeric size is the
 * maximum edge length. The full source frame and aspect ratio are preserved;
 * variants are encoded independently from the original and never upscaled.
 */
export function processFoodImage(
  inputBuffer: Buffer,
  options: ImageProcessingOptions & { generateHierarchy: false }
): Promise<ProcessedImageOnDemandResult>;
export function processFoodImage(inputBuffer: Buffer, options?: ImageProcessingOptions): Promise<ProcessedImageResult>;
export async function processFoodImage(
  inputBuffer: Buffer,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImageResult | ProcessedImageOnDemandResult> {
  const validated = await validateImageBuffer(inputBuffer);
  const focalPoint: FocalPoint = { x: 0.5, y: 0.5 }; // Kept for old metadata clients; no crop is applied.
  const targetWidth = options.width ?? 480;
  const targetHeight = options.height ?? 480;
  const primaryMaxEdge = Math.max(targetWidth, targetHeight);
  if (!Number.isInteger(primaryMaxEdge) || primaryMaxEdge < MIN_PRIMARY_EDGE) {
    throw new ImageProcessingError(`Primary maximum edge must be an integer of at least ${MIN_PRIMARY_EDGE}px.`);
  }

  const quality = options.initialQuality ?? DEFAULT_WEBP_QUALITY;
  const effort = options.effort ?? 6;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new ImageProcessingError('WebP quality must be an integer from 1 to 100.');
  }

  const orientedWidth = validated.orientation && validated.orientation >= 5 && validated.orientation <= 8
    ? validated.height
    : validated.width;
  const orientedHeight = validated.orientation && validated.orientation >= 5 && validated.orientation <= 8
    ? validated.width
    : validated.height;
  const sourceMaxEdge = Math.max(orientedWidth, orientedHeight);

  let primary: EncodedVariant;
  let thumbnail: EncodedVariant | undefined;
  try {
    // Always encode from the source to avoid generational loss. The web app
    // stores one original and asks the delivery endpoint to make other sizes.
    primary = await encodeVariant(inputBuffer, primaryMaxEdge, quality, effort);
    if (options.generateHierarchy !== false) {
      thumbnail = await encodeVariant(inputBuffer, 128, THUMBNAIL_WEBP_QUALITY, effort);
    }
  } catch (err) {
    throw new ImageProcessingError(
      `Failed to create full-frame WebP images: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let retina: EncodedVariant | undefined;
  let hiRes: EncodedVariant | undefined;
  try {
    if (options.generateHierarchy !== false && sourceMaxEdge >= 960) retina = await encodeVariant(inputBuffer, 960, quality, effort);
    if (options.generateHierarchy !== false && sourceMaxEdge >= 1600) hiRes = await encodeVariant(inputBuffer, 1600, quality, effort);
  } catch (err) {
    throw new ImageProcessingError(
      `Failed to create a high-resolution WebP variant: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const hash = crypto.createHash('sha256').update(primary.buffer).digest('hex');
  let perceptualHash: string;
  try {
    perceptualHash = await computePerceptualHash(inputBuffer);
  } catch (err) {
    throw new ImageProcessingError(
      `Failed to calculate image similarity hash: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return {
    buffer: primary.buffer,
    hash,
    perceptualHash,
    width: primary.width,
    height: primary.height,
    format: 'webp',
    sourceFormat: validated.format,
    byteSize: primary.buffer.length,
    focalPoint,
    qualityUsed: quality,
    sourceDimensions: { width: orientedWidth, height: orientedHeight },
    thumbnailBuffer: thumbnail?.buffer,
    thumbnailWidth: thumbnail?.width,
    thumbnailHeight: thumbnail?.height,
    thumbnailByteSize: thumbnail?.buffer.length,
    thumbnailHash: thumbnail ? crypto.createHash('sha256').update(thumbnail.buffer).digest('hex') : undefined,
    retinaBuffer: retina?.buffer,
    retinaWidth: retina?.width,
    retinaHeight: retina?.height,
    retinaByteSize: retina?.buffer.length,
    hiResBuffer: hiRes?.buffer,
    hiResWidth: hiRes?.width,
    hiResHeight: hiRes?.height,
    hiResByteSize: hiRes?.buffer.length,
  };
}
