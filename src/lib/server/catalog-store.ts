/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { foodImages } from 'acropin-food-images';
import { getStorageProvider } from '../storage/image-storage.js';
import { readPersistentJson, writePersistentJson } from '../storage/persistent-json.js';
import type { AssetApprovalStatus, ImageAsset } from '../images/types.js';

const CATALOG_DATA_FILE = path.resolve(process.cwd(), './storage/catalog.json');

let assetCatalog: ImageAsset[] = [];
let isInitialized = false;
let initializePromise: Promise<void> | null = null;
let pendingSave: Promise<void> = Promise.resolve();

function getPackageAssets(): ImageAsset[] {
  const loadedAt = new Date().toISOString();
  return foodImages.map((image) => ({
    id: image.id,
    canonicalDishId: image.canonicalDishId,
    storageKey: `npm-package/${image.slug}`,
    publicUrl: image.url,
    sha256Hash: image.sha256,
    width: image.width,
    height: image.height,
    format: 'webp',
    byteSize: image.byteSize,
    sourceUrl: image.sourceUrl,
    sourceProvider: new URL(image.sourceUrl).hostname,
    licenseType: image.license === 'CC0-1.0' ? 'CC0' : 'CC-BY-4.0',
    licenseEvidence: image.licenseEvidenceUrl,
    requiredAttribution: image.attribution,
    processingVersion: 'v1',
    processingQuality: 78,
    focalPoint: { ...image.focalPoint },
    approvalStatus: 'approved',
    createdAt: loadedAt,
    updatedAt: loadedAt,
    tags: [...image.tags, 'npm-package'],
    dishName: image.dishName,
    universalName: image.slug,
    filename: `${image.slug}.webp`,
    originalByteSize: image.originalByteSize,
  }));
}

function saveCatalogToFile() {
  const snapshot = assetCatalog.filter((asset) => !asset.tags?.includes('npm-package'));
  pendingSave = pendingSave.catch(() => undefined).then(() =>
    writePersistentJson('app-data/catalog.json', CATALOG_DATA_FILE, snapshot)
  );
}

/**
 * Initialize catalog store.
 * Real production data only - no synthetic or toy mock assets.
 */
export async function initializeCatalog(): Promise<void> {
  if (isInitialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      try {
        const parsed = await readPersistentJson<ImageAsset[]>('app-data/catalog.json', CATALOG_DATA_FILE);
        // Filter out any legacy synthetic assets or test fixture items
        const packageAssets = getPackageAssets();
        const packageSlugs = new Set(packageAssets.map((asset) => asset.universalName));
        const storedAssets = Array.isArray(parsed)
          ? parsed.filter((a) => !a.tags?.includes('seed-catalog') && !a.tags?.includes('fixture') && !a.tags?.includes('npm-package'))
          : [];
        // A reviewed npm contribution takes precedence over an older app-managed
        // image with the same universal dish name.
        assetCatalog = [
          ...storedAssets.filter((asset) => !packageSlugs.has(asset.universalName)),
          ...packageAssets,
        ];
      } catch {
        assetCatalog = [];
      }
      isInitialized = true;
    })();
  }
  await initializePromise;
}

export async function flushCatalog(): Promise<void> {
  await pendingSave;
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
  if (assetCatalog[index].tags?.includes('npm-package')) return false;

  const [removed] = assetCatalog.splice(index, 1);
  saveCatalogToFile();
  await flushCatalog();

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

export function isPackageAsset(id: string): boolean {
  initializeCatalog();
  return assetCatalog.some((asset) => asset.id === id && asset.tags?.includes('npm-package'));
}

export function updateAssetStatus(
  assetId: string,
  newStatus: AssetApprovalStatus,
  reason?: string
): ImageAsset | undefined {
  initializeCatalog();
  const asset = assetCatalog.find((a) => a.id === assetId);
  if (!asset || asset.tags?.includes('npm-package')) return undefined;

  asset.approvalStatus = newStatus;
  asset.updatedAt = new Date().toISOString();
  if (reason) {
    asset.rejectionReason = reason;
  }

  saveCatalogToFile();
  return asset;
}
