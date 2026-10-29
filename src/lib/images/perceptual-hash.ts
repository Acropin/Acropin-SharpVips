/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import sharp from 'sharp';

const HASH_SIZE = 32;
const LOW_FREQUENCY_SIZE = 8;
export const MAX_PERCEPTUAL_DUPLICATE_DISTANCE = 6;
const NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const;

/**
 * Build a compact DCT perceptual hash. It is intended for near-duplicate
 * detection after resize/re-encoding; it is not a license or provenance check.
 */
export async function computePerceptualHash(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image, { failOn: 'error' })
    .rotate()
    .greyscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== HASH_SIZE || info.height !== HASH_SIZE || info.channels !== 1 || data.length !== HASH_SIZE * HASH_SIZE) {
    throw new Error('Could not prepare image pixels for perceptual hashing.');
  }

  const cosine = Array.from({ length: LOW_FREQUENCY_SIZE }, (_, frequency) =>
    Float64Array.from({ length: HASH_SIZE }, (_, position) =>
      Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * HASH_SIZE))
    )
  );
  const coefficients: number[] = [];

  for (let v = 0; v < LOW_FREQUENCY_SIZE; v += 1) {
    const scaleY = v === 0 ? Math.sqrt(1 / HASH_SIZE) : Math.sqrt(2 / HASH_SIZE);
    for (let u = 0; u < LOW_FREQUENCY_SIZE; u += 1) {
      const scaleX = u === 0 ? Math.sqrt(1 / HASH_SIZE) : Math.sqrt(2 / HASH_SIZE);
      let coefficient = 0;
      for (let y = 0; y < HASH_SIZE; y += 1) {
        const rowOffset = y * HASH_SIZE;
        for (let x = 0; x < HASH_SIZE; x += 1) {
          coefficient += data[rowOffset + x] * cosine[u][x] * cosine[v][y];
        }
      }
      coefficients.push(coefficient * scaleX * scaleY);
    }
  }

  const sorted = [...coefficients].sort((left, right) => left - right);
  const median = (sorted[31] + sorted[32]) / 2;
  let hash = 0n;
  for (const coefficient of coefficients) {
    hash = (hash << 1n) | (coefficient >= median ? 1n : 0n);
  }
  return hash.toString(16).padStart(16, '0');
}

/** Return the number of differing bits between two valid 64-bit pHashes. */
export function perceptualHashDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/iu.test(left) || !/^[a-f0-9]{16}$/iu.test(right)) {
    throw new Error('Perceptual hashes must be 16 hexadecimal characters.');
  }

  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const differingBits = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += NIBBLE_POPCOUNT[differingBits];
  }
  return distance;
}
