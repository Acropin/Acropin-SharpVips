/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ImageAsset } from '../images/types.js';
import { parseDatasetTargetImport } from './dataset-target-import.js';

test('menu CSV imports retain veg and non-veg values from both supported columns', () => {
  const rows = parseDatasetTargetImport([
    'item_id,item_name,region,menu_category,diet_type,is_vegetarian,description',
    'FD0001,Dal makhani,North,Main Course,Veg,Yes,Slow cooked lentils',
    'FD0002,Chicken tikka,North,Starter,Non-veg,No,Grilled chicken',
  ].join('\n'));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].dietary, 'veg');
  assert.equal(rows[1].dietary, 'non-veg');
  assert.equal(rows[1].sourceId, 'FD0002');
});

test('a fresh inventory read sees menu rows saved by another app instance', async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'acropin-target-refresh-'));
  const originalDataDirectory = process.env.ACROPIN_DATA_DIR;
  process.env.ACROPIN_DATA_DIR = dataDirectory;

  try {
    const store = await import('../server/dataset-target-store.js');
    await store.withFreshTargetDataset(async () => {
      store.bulkImportTargets([
        { name: 'Dal makhani', category: 'Main Course', dietary: 'veg' },
      ]);
      await store.flushTargets();
    });

    const storedPath = path.join(dataDirectory, 'dataset-targets.json');
    const externalTarget = {
      id: 'target_chicken-tikka__starter__all-regions',
      name: 'Chicken Tikka',
      universalSlug: 'chicken-tikka',
      category: 'Starter',
      dietary: 'non-veg',
      createdAt: new Date().toISOString(),
    };
    const storedTargets = JSON.parse(await fs.readFile(storedPath, 'utf8')) as unknown[];
    await fs.writeFile(storedPath, JSON.stringify([...storedTargets, externalTarget]), 'utf8');

    const refreshedTargets = await store.withFreshTargetDataset(() => store.getAllTargetItems());
    assert.deepEqual(refreshedTargets.map((item) => item.universalSlug), ['dal-makhani', 'chicken-tikka']);
    assert.equal(refreshedTargets[1].dietary, 'non-veg');

    const inventory = store.computeDatasetStatus([{
      id: 'asset-dal-makhani',
      universalName: 'dal-makhani',
      publicUrl: '/api/images/dal-makhani.webp',
      createdAt: new Date().toISOString(),
    } as unknown as ImageAsset]);
    const alreadyPublishedDish = inventory.rows.find((row) => row.universalSlug === 'dal-makhani');
    assert.equal(alreadyPublishedDish?.status, 'available');
    assert.equal(alreadyPublishedDish?.dietary, 'veg');
  } finally {
    if (originalDataDirectory === undefined) delete process.env.ACROPIN_DATA_DIR;
    else process.env.ACROPIN_DATA_DIR = originalDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});
