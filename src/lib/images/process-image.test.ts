/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processFoodImage, validateImageBuffer, calculateSquareCrop } from './process-image';
import { ImageValidationError, ImageTooSmallError } from './errors';

test('calculateSquareCrop accurately computes focal bounds', () => {
  // Center focal point on 1000x600 image
  const centerCrop = calculateSquareCrop(1000, 600, { x: 0.5, y: 0.5 });
  assert.equal(centerCrop.size, 600);
  assert.equal(centerCrop.left, 200); // (0.5 * 1000) - 300 = 200
  assert.equal(centerCrop.top, 0);

  // Left-aligned focal point
  const leftCrop = calculateSquareCrop(1000, 600, { x: 0.1, y: 0.5 });
  assert.equal(leftCrop.left, 0); // clamped to 0

  // Right-aligned focal point
  const rightCrop = calculateSquareCrop(1000, 600, { x: 0.9, y: 0.5 });
  assert.equal(rightCrop.left, 400); // clamped to 1000 - 600 = 400
});

test('processFoodImage creates exact 480x480 WebP with hash and metadata', async () => {
  // Generate real synthetic image with distinct patterns to test real libvips processing
  const testInput = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: { r: 220, g: 110, b: 35, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="400"><circle cx="200" cy="200" r="180" fill="#2d7a46" /><rect x="50" y="50" width="100" height="100" fill="#f4d03f"/></svg>'
        ),
        top: 100,
        left: 200,
      },
    ])
    .png()
    .toBuffer();

  const result = await processFoodImage(testInput, {
    focalPoint: { x: 0.5, y: 0.5 },
    initialQuality: 78,
  });

  assert.equal(result.width, 480);
  assert.equal(result.height, 480);
  assert.equal(result.format, 'webp');
  assert.ok(result.byteSize > 0);
  assert.ok(result.byteSize <= 45 * 1024); // verify reasonable file size
  assert.equal(typeof result.hash, 'string');
  assert.equal(result.hash.length, 64); // SHA-256 hex string

  // Verify the output buffer with sharp metadata
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 480);
  assert.equal(meta.format, 'webp');

  // Verify the 128x128 thumbnail buffer
  assert.equal(result.thumbnailWidth, 128);
  assert.equal(result.thumbnailHeight, 128);
  assert.ok(result.thumbnailByteSize > 0);
  assert.ok(result.thumbnailByteSize < result.byteSize);
  const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
  assert.equal(thumbMeta.width, 128);
  assert.equal(thumbMeta.height, 128);
  assert.equal(thumbMeta.format, 'webp');
});

test('validateImageBuffer rejects undersized images that cannot produce quality 480x480', async () => {
  const smallInput = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  await assert.rejects(
    async () => {
      await validateImageBuffer(smallInput);
    },
    (err: unknown) => {
      return err instanceof ImageTooSmallError;
    }
  );
});

test('validateImageBuffer rejects invalid or corrupted image data', async () => {
  const garbage = Buffer.from('NOT_AN_IMAGE_FILE_DATA_CORRUPT');
  await assert.rejects(
    async () => {
      await validateImageBuffer(garbage);
    },
    (err: unknown) => {
      return err instanceof ImageValidationError;
    }
  );
});

test('processFoodImage EXIF orientation correction', async () => {
  // Create an image with an EXIF orientation flag
  const orientedInput = await sharp({
    create: {
      width: 600,
      height: 800,
      channels: 3,
      background: { r: 50, g: 100, b: 200 },
    },
  })
    .withMetadata({ orientation: 6 }) // 90 degree rotate
    .jpeg()
    .toBuffer();

  const result = await processFoodImage(orientedInput);
  assert.equal(result.width, 480);
  assert.equal(result.height, 480);
  assert.equal(result.format, 'webp');
});
