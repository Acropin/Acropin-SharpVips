/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { inspectFoodImageWithMl } from './ml-anti-corruption.js';

test('inspectFoodImageWithMl approves valid food image with color complexity', async () => {
  // Test fast deterministic CV inspection by scoping GEMINI_API_KEY for pure unit testing
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';

  try {
    const validBuffer = await sharp({
      create: {
        width: 480,
        height: 480,
        channels: 3,
        background: { r: 180, g: 80, b: 40 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="400" height="400"><circle cx="200" cy="200" r="160" fill="#2d7a46" /><rect x="80" y="80" width="120" height="120" fill="#f4d03f"/><polygon points="200,50 300,200 100,200" fill="#c0392b"/></svg>'
          ),
          top: 40,
          left: 40,
        },
      ])
      .webp()
      .toBuffer();

    const inspection = await inspectFoodImageWithMl(validBuffer, 'Margherita Pizza', 'margherita-pizza');
    assert.equal(inspection.isFood, true);
    assert.equal(inspection.antiCorruptionPassed, true);
    assert.ok(inspection.qualityScore >= 40);
    assert.ok(inspection.modelUsed);
  } finally {
    process.env.GEMINI_API_KEY = originalKey;
  }
});

test('inspectFoodImageWithMl rejects solid-color canvas as dataset corruption', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';

  try {
    // Create a completely uniform solid black/gray canvas with 0 color variance
    const solidBuffer = await sharp({
      create: {
        width: 480,
        height: 480,
        channels: 3,
        background: { r: 50, g: 50, b: 50 },
      },
    })
      .webp()
      .toBuffer();

    const inspection = await inspectFoodImageWithMl(solidBuffer, 'Margherita Pizza', 'margherita-pizza');
    assert.equal(inspection.antiCorruptionPassed, false);
    assert.ok(inspection.rejectionReason);
    assert.match(inspection.rejectionReason, /anti-corruption|blank|canvas/i);
  } finally {
    process.env.GEMINI_API_KEY = originalKey;
  }
});
