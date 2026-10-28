/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { getStorageProvider } from '../storage/image-storage';
import type { AssetApprovalStatus, ImageAsset } from '../images/types';

const CATALOG_DATA_FILE = path.resolve(process.cwd(), './storage/catalog.json');

let assetCatalog: ImageAsset[] = [];
let isInitialized = false;

function ensureStorageDir() {
  const dir = path.dirname(CATALOG_DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveCatalogToFile() {
  ensureStorageDir();
  fs.writeFileSync(CATALOG_DATA_FILE, JSON.stringify(assetCatalog, null, 2), 'utf-8');
}

function loadCatalogFromFile() {
  ensureStorageDir();
  if (fs.existsSync(CATALOG_DATA_FILE)) {
    try {
      const raw = fs.readFileSync(CATALOG_DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Filter out any legacy synthetic assets or test fixture items
      assetCatalog = Array.isArray(parsed)
        ? parsed.filter((a) => !a.tags?.includes('seed-catalog') && !a.tags?.includes('fixture'))
        : [];
    } catch {
      assetCatalog = [];
    }
  }
}

/**
 * Initialize catalog store.
 * Real production data only - no synthetic or toy mock assets.
 */
export async function initializeCatalog(): Promise<void> {
  if (isInitialized) return;
  loadCatalogFromFile();
  isInitialized = true;
}

export function getAllAssets(filter?: {
  status?: AssetApprovalStatus;
  search?: string;
  dishId?: string;
}): ImageAsset[] {
  initializeCatalog();
  let list = assetCatalog.filter((a) => !a.tags?.includes('fixture'));

  if (filter?.status) {
    list = list.filter((a) => a.approvalStatus === filter.status);
  }

  if (filter?.dishId) {
    list = list.filter((a) => a.canonicalDishId === filter.dishId);
  }

  if (filter?.search) {
    const q = filter.search.toLowerCase().trim();
    list = list.filter(
      (a) =>
        a.dishName.toLowerCase().includes(q) ||
        a.universalName?.toLowerCase().includes(q) ||
        a.filename?.toLowerCase().includes(q) ||
        a.tags?.some((t) => t.toLowerCase().includes(q)) ||
        (a.requiredAttribution && a.requiredAttribution.toLowerCase().includes(q))
    );
  }

  return list;
}

export function getAssetById(id: string): ImageAsset | undefined {
  initializeCatalog();
  return assetCatalog.find((a) => a.id === id || a.universalName === id);
}

export function findAssetByHash(hash: string): ImageAsset | undefined {
  initializeCatalog();
  return assetCatalog.find((a) => a.sha256Hash === hash);
}

export function registerAsset(asset: ImageAsset): ImageAsset {
  initializeCatalog();
  const existingIdx = assetCatalog.findIndex((a) => a.id === asset.id || a.universalName === asset.universalName);
  if (existingIdx >= 0) {
    assetCatalog[existingIdx] = asset;
  } else {
    assetCatalog.unshift(asset);
  }
  saveCatalogToFile();
  return asset;
}

export async function deleteAsset(id: string): Promise<boolean> {
  initializeCatalog();
  const index = assetCatalog.findIndex((a) => a.id === id);
  if (index === -1) return false;

  const [removed] = assetCatalog.splice(index, 1);
  saveCatalogToFile();

  if (removed?.storageKey) {
    try {
      const storage = getStorageProvider();
      await storage.delete(removed.storageKey);
    } catch (err) {
      console.warn(`Could not delete storage file for ${removed.storageKey}:`, err);
    }
  }

  return true;
}

export function updateAssetStatus(
  assetId: string,
  newStatus: AssetApprovalStatus,
  reason?: string
): ImageAsset | undefined {
  initializeCatalog();
  const asset = assetCatalog.find((a) => a.id === assetId);
  if (!asset) return undefined;

  asset.approvalStatus = newStatus;
  asset.updatedAt = new Date().toISOString();
  if (reason) {
    asset.rejectionReason = reason;
  }

  saveCatalogToFile();
  return asset;
}
