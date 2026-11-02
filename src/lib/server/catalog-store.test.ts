import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ImageAsset } from '../images/types.js';
import { findBlockingAssetBySlug, refreshCatalogFromStorage } from './catalog-store.js';
import { mergeLegacyAndFirestoreImageAssets } from './catalog-merge.js';

test('fresh catalog reads remove stale in-memory dish entries when durable inventory is empty', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'acropin-catalog-refresh-'));
  const originalDataDirectory = process.env.ACROPIN_DATA_DIR;
  const slug = `catalog-refresh-check-${process.pid}`;
  const asset: ImageAsset = {
    id: `asset-${process.pid}`,
    storageKey: 'food-assets/catalog-refresh-check/480.webp',
    publicUrl: '/api/images/food-assets/catalog-refresh-check/480.webp',
    sha256Hash: 'a'.repeat(64),
    width: 480,
    height: 480,
    format: 'webp',
    byteSize: 1000,
    sourceProvider: 'Contributor upload',
    licenseType: 'CC0',
    licenseEvidence: 'Contributor attestation: created by the contributor',
    rightsAttested: true,
    rightsAttestedAt: new Date().toISOString(),
    processingVersion: 'v1',
    processingQuality: 78,
    focalPoint: { x: 0.5, y: 0.5 },
    approvalStatus: 'pending_review',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    dishName: 'Catalog Refresh Check',
    universalName: slug,
    filename: `${slug}.webp`,
  };

  try {
    process.env.ACROPIN_DATA_DIR = tempDirectory;
    const catalogPath = path.join(tempDirectory, 'catalog.json');
    await fs.promises.writeFile(catalogPath, JSON.stringify([asset]), 'utf8');
    await refreshCatalogFromStorage();
    assert.equal(findBlockingAssetBySlug(slug)?.id, asset.id);

    await fs.promises.writeFile(catalogPath, '[]', 'utf8');
    await refreshCatalogFromStorage();
    assert.equal(findBlockingAssetBySlug(slug), undefined);
  } finally {
    if (originalDataDirectory === undefined) delete process.env.ACROPIN_DATA_DIR;
    else process.env.ACROPIN_DATA_DIR = originalDataDirectory;
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});


test('partial Firestore migration preserves legacy assets and prefers newer Firestore records', () => {
  const legacyAsset = {
    id: 'legacy-matar-paneer',
    storageKey: 'food-assets/legacy-matar-paneer/source.webp',
    dishName: 'Matar Paneer',
    approvalStatus: 'pending_review',
  } as ImageAsset;
  const outdated = {
    ...legacyAsset,
    id: 'shared-asset',
    storageKey: 'food-assets/shared-asset/source.webp',
    approvalStatus: 'pending_review',
  } as ImageAsset;
  const current = { ...outdated, approvalStatus: 'approved' } as ImageAsset;

  const merged = mergeLegacyAndFirestoreImageAssets([legacyAsset, outdated], [current]);

  assert.deepEqual(merged.map((asset) => asset.id), ['legacy-matar-paneer', 'shared-asset']);
  assert.equal(merged.find((asset) => asset.id === 'shared-asset')?.approvalStatus, 'approved');
});
