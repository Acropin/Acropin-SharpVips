/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAppDataFile } from '../storage/data-directory.js';
import { isBlobStorageConfigured, readPersistentJson, writePersistentJson } from '../storage/persistent-json.js';
import { toUniversalFoodName } from '../images/universal-naming.js';
import { CANONICAL_DISHES } from '../catalog/canonical-dishes.js';
import type { DatasetTargetItem, ImageAsset, DishDietary, DatasetTargetDietary, AcropinMetadataTags } from '../images/types.js';

const targetsDataFile = () => getAppDataFile('dataset-targets.json');

let targetDataset: DatasetTargetItem[] = [];
let isInitialized = false;
let initializePromise: Promise<void> | null = null;
let pendingSave: Promise<void> = Promise.resolve();
let targetDatasetOperationQueue: Promise<void> = Promise.resolve();

const LEGACY_SEED_TARGET_IDS = new Set([
  'target_margherita-pizza',
  'target_classic-cheeseburger',
  'target_tonkotsu-ramen',
  'target_caesar-salad',
  'target_spaghetti-carbonara',
  'target_crispy-french-fries',
  'target_grilled-atlantic-salmon',
  'target_chicken-biryani',
  'target_classic-tiramisu',
  'target_chocolate-fudge-brownie',
  'target_cappuccino',
  'target_fresh-guacamole-chips',
  'target_crispy-street-tacos',
  'target_greek-salad',
  'target_triple-decker-club-sandwich',
  'target_tom-yum-soup',
  'target_mango-smoothie',
  'target_butter-croissant',
]);

function saveTargetsToFile() {
  const snapshot = targetDataset.map((item) => ({
    ...item,
    ...(item.sourceIds ? { sourceIds: [...item.sourceIds] } : {}),
  }));
  pendingSave = pendingSave.catch(() => undefined).then(() =>
    writePersistentJson('app-data/dataset-targets.json', targetsDataFile(), snapshot)
  );
}

export async function initializeTargetDataset(): Promise<void> {
  if (isInitialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      const stored = await readPersistentJson<unknown>(
        'app-data/dataset-targets.json',
        targetsDataFile()
      );
      if (stored === null) {
        targetDataset = [];
      } else if (Array.isArray(stored) && stored.every(isDatasetTargetItem)) {
        // An intentionally empty inventory is valid and must stay empty.
        targetDataset = stored.filter((item) => !LEGACY_SEED_TARGET_IDS.has(item.id));
        if (targetDataset.length !== stored.length &&
            (isBlobStorageConfigured() || process.env.VERCEL !== '1')) {
          saveTargetsToFile();
          await flushTargets();
        }
      } else {
        throw new Error('Dataset target storage is invalid. Fix the stored data before accepting changes.');
      }
      isInitialized = true;
    })();
  }

  try {
    await initializePromise;
  } catch (error) {
    initializePromise = null;
    throw error;
  }
}

function isDatasetTargetItem(value: unknown): value is DatasetTargetItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Partial<DatasetTargetItem>;
  return (
    typeof target.id === 'string' &&
    typeof target.name === 'string' && target.name.trim().length > 0 &&
    typeof target.universalSlug === 'string' && target.universalSlug.trim().length > 0 &&
    typeof target.category === 'string' && target.category.trim().length > 0 &&
    (target.region === undefined || typeof target.region === 'string') &&
    (target.dietary === 'veg' || target.dietary === 'non-veg' || target.dietary === 'vegan' ||
      target.dietary === 'egg' || target.dietary === 'mixed' || target.dietary === 'unknown') &&
    (target.sourceIds === undefined || (Array.isArray(target.sourceIds) && target.sourceIds.every((id) => typeof id === 'string'))) &&
    typeof target.createdAt === 'string'
  );
}

export async function flushTargets(): Promise<void> {
  await pendingSave;
}

/** Reload the latest shared target list so warm server instances do not serve stale inventory. */
export async function refreshTargetDataset(): Promise<void> {
  await initializeTargetDataset();
  await flushTargets();

  const stored = await readPersistentJson<unknown>(
    'app-data/dataset-targets.json',
    targetsDataFile()
  );
  if (stored === null) {
    targetDataset = [];
    return;
  }
  if (!Array.isArray(stored) || !stored.every(isDatasetTargetItem)) {
    throw new Error('Dataset target storage is invalid. Fix the stored data before accepting changes.');
  }

  const latestTargets = stored.filter((item) => !LEGACY_SEED_TARGET_IDS.has(item.id));
  targetDataset = latestTargets;
  if (latestTargets.length !== stored.length) {
    saveTargetsToFile();
    await flushTargets();
  }
}

/** Run a read or write against a fresh inventory, in order with other requests on this instance. */
export async function withFreshTargetDataset<T>(operation: () => T | Promise<T>): Promise<T> {
  const previousOperation = targetDatasetOperationQueue;
  let releaseOperation!: () => void;
  targetDatasetOperationQueue = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });

  await previousOperation;
  try {
    await refreshTargetDataset();
    return await operation();
  } finally {
    releaseOperation();
  }
}

export function getAllTargetItems(): DatasetTargetItem[] {
  initializeTargetDataset();
  return [...targetDataset];
}

export function addTargetItem(
  name: string,
  category: string,
  dietary: DishDietary,
  region?: string,
  notes?: string
): DatasetTargetItem {
  initializeTargetDataset();
  if (!name.trim()) throw new Error('Dish name is required.');
  if (!category.trim()) throw new Error('Dish category is required.');
  if (!['veg', 'non-veg', 'vegan'].includes(dietary)) {
    throw new Error('Choose a dietary value: veg, non-veg, or vegan.');
  }
  if (region !== undefined && typeof region !== 'string') throw new Error('Region must be text.');
  if (notes !== undefined && typeof notes !== 'string') throw new Error('Notes must be text.');
  const universal = toUniversalFoodName(name);
  if (!universal.universalName) throw new Error('Dish name must include letters or numbers.');
  const normalizedRegion = region?.trim().toLowerCase() || '';
  const existingIdx = targetDataset.findIndex((t) =>
    t.universalSlug === universal.universalName &&
    t.category.trim().toLowerCase() === category.trim().toLowerCase() &&
    (t.region?.trim().toLowerCase() || '') === normalizedRegion
  );

  const item: DatasetTargetItem = {
    id: `target_${universal.universalName}__${toUniversalFoodName(category).universalName || 'category'}__all-regions`,
    name: universal.displayName,
    universalSlug: universal.universalName,
    region: region?.trim() || undefined,
    category: category.trim(),
    dietary,
    notes,
    createdAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    targetDataset[existingIdx] = item;
  } else {
    targetDataset.push(item);
  }

  saveTargetsToFile();
  return item;
}

/**
 * Bulk import rows pasted from Excel or CSV files.
 * Format of each row: { name, category, dietary, region?, notes? }
 */
export function bulkImportTargets(
  items: Array<{ sourceId?: string; name: string; category: string; dietary: string; region?: string; notes?: string }>,
  replaceExisting = false
): { added: number; total: number } {
  initializeTargetDataset();
  if (items.length === 0) throw new Error('Provide at least one dish row before importing.');

  const validatedItems = items.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Row ${index + 1} must contain a dish name, category, and dietary value.`);
    }
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const category = typeof raw.category === 'string' ? raw.category.trim() : '';
    const dietary = raw.dietary;
    if (!name) throw new Error(`Row ${index + 1}: dish name is required.`);
    if (!category) throw new Error(`Row ${index + 1}: category is required.`);
    if (!['veg', 'non-veg', 'vegan', 'egg', 'mixed', 'unknown'].includes(dietary)) {
      throw new Error(`Row ${index + 1}: dietary value must be veg, non-veg, vegan, egg, mixed, or unknown.`);
    }
    if (raw.region !== undefined && typeof raw.region !== 'string') {
      throw new Error(`Row ${index + 1}: region must be text.`);
    }
    if (raw.notes !== undefined && typeof raw.notes !== 'string') {
      throw new Error(`Row ${index + 1}: notes must be text.`);
    }
    if (raw.sourceId !== undefined && typeof raw.sourceId !== 'string') {
      throw new Error(`Row ${index + 1}: source ID must be text.`);
    }
    return { ...raw, name, category, dietary: dietary as DatasetTargetDietary };
  });

  if (replaceExisting) {
    targetDataset = [];
  }

  const identityOf = (slug: string, category: string, region?: string) =>
    [slug, category.trim().toLowerCase(), region?.trim().toLowerCase() || ''].join('\u0000');
  const targetsByIdentity = new Map(
    targetDataset.map((target) => [identityOf(target.universalSlug, target.category, target.region), target])
  );
  let addedCount = 0;
  for (const raw of validatedItems) {
    const universal = toUniversalFoodName(raw.name);
    if (!universal.universalName) throw new Error(`Dish name "${raw.name}" must include letters or numbers.`);
    const normalizedRegion = raw.region?.trim().toLowerCase() || '';
    const identity = identityOf(universal.universalName, raw.category, normalizedRegion);
    const existing = targetsByIdentity.get(identity);
    if (existing) {
      const sourceId = raw.sourceId?.trim();
      if (sourceId) existing.sourceIds = [...new Set([...(existing.sourceIds || []), sourceId])];
      if (existing.dietary !== raw.dietary && existing.dietary !== 'unknown' && raw.dietary !== 'unknown') {
        existing.dietary = 'mixed';
      } else if (existing.dietary === 'unknown' && raw.dietary !== 'unknown') {
        existing.dietary = raw.dietary;
      }
      if (!existing.notes && raw.notes?.trim()) existing.notes = raw.notes.trim();
    } else {
      const categorySlug = toUniversalFoodName(raw.category).universalName || 'category';
      const regionSlug = normalizedRegion
        ? toUniversalFoodName(raw.region || '').universalName || 'region'
        : 'all-regions';
      const sourceIds = raw.sourceId?.trim() ? [raw.sourceId.trim()] : undefined;
      targetDataset.push({
        id: `target_${universal.universalName}__${categorySlug}__${regionSlug}`,
        name: universal.displayName,
        universalSlug: universal.universalName,
        region: raw.region?.trim() || undefined,
        category: raw.category,
        dietary: raw.dietary,
        sourceIds,
        notes: raw.notes ? String(raw.notes).trim() : undefined,
        createdAt: new Date().toISOString(),
      });
      targetsByIdentity.set(identity, targetDataset[targetDataset.length - 1]);
      addedCount++;
    }
  }

  saveTargetsToFile();
  return { added: addedCount, total: targetDataset.length };
}

export function deleteTargetItem(idOrSlug: string): boolean {
  initializeTargetDataset();
  const idx = targetDataset.findIndex((t) => t.id === idOrSlug || t.universalSlug === idOrSlug);
  if (idx === -1) return false;
  targetDataset.splice(idx, 1);
  saveTargetsToFile();
  return true;
}

export function clearAllTargetItems(): void {
  initializeTargetDataset();
  targetDataset = [];
  saveTargetsToFile();
}

export interface InventoryTableRow {
  id: string;
  name: string;
  universalSlug: string;
  category: string;
  dietary: DatasetTargetDietary;
  region?: string;
  status: 'available' | 'missing' | 'in_review';
  asset?: ImageAsset;
  variantsAvailable: string[];
  fileSizeKb: number;
  metadataTags?: AcropinMetadataTags;
  recommendedAiPrompt: string;
}

/**
 * Computes live Excel-like table inventory showing exactly:
 * - How many images are available in library
 * - How many images are still missing
 * - Status per row with all 4 variants (128, 480, 960, 1600)
 * - Clean Acropin metadata tag system
 * - Tailored AI prompt for contributors
 */
export function computeDatasetStatus(
  approvedAssets: ImageAsset[],
  pendingAssets: ImageAsset[] = []
): {
  totalTargetDishes: number;
  completedCount: number;
  missingCount: number;
  pendingCount: number;
  coveragePercent: number;
  categoryBreakdown: Record<string, { total: number; completed: number; missing: number; percentage: number }>;
  rows: InventoryTableRow[];
  completedDishes: Array<DatasetTargetItem & { asset: ImageAsset }>;
  missingDishes: Array<DatasetTargetItem & { recommendedAiPrompt: string }>;
} {
  initializeTargetDataset();

  // Map approved assets by universalSlug and ID
  const approvedMap = new Map<string, ImageAsset>();
  for (const asset of approvedAssets) {
    if (asset.universalName) {
      approvedMap.set(asset.universalName.toLowerCase(), asset);
    }
    if (asset.canonicalDishId) {
      approvedMap.set(asset.canonicalDishId.toLowerCase(), asset);
    }
    if (asset.id) {
      approvedMap.set(asset.id.toLowerCase(), asset);
    }
  }

  // Map pending review assets
  const pendingMap = new Map<string, ImageAsset>();
  for (const asset of pendingAssets) {
    if (asset.universalName) {
      pendingMap.set(asset.universalName.toLowerCase(), asset);
    }
  }

  const rows: InventoryTableRow[] = [];
  const completedDishes: Array<DatasetTargetItem & { asset: ImageAsset }> = [];
  const missingDishes: Array<DatasetTargetItem & { recommendedAiPrompt: string }> = [];

  const categoryStats: Record<string, { total: number; completed: number; missing: number }> = {};

  for (const target of targetDataset) {
    const cat = target.category;
    if (!categoryStats[cat]) {
      categoryStats[cat] = { total: 0, completed: 0, missing: 0 };
    }
    categoryStats[cat].total++;

    const matchedApproved =
      approvedMap.get(target.universalSlug.toLowerCase()) ||
      approvedMap.get(target.id.toLowerCase());

    const matchedPending = pendingMap.get(target.universalSlug.toLowerCase());

    // Prompt specifically crafted for contributors using ChatGPT / AI models
    const aiPrompt = `Award-winning commercial cuisine and product photograph of ${target.name}, professional studio lighting, shallow depth of field, 8k resolution, crisp detail, gourmet restaurant menu presentation, clean minimalist background, photorealistic style, no text, no watermark.`;

    if (matchedApproved) {
      categoryStats[cat].completed++;
      completedDishes.push({
        ...target,
        asset: matchedApproved,
      });

      const variants: string[] = [`${matchedApproved.width}x${matchedApproved.height}`];
      if (matchedApproved.thumbnailUrl) variants.unshift(`${matchedApproved.thumbnailWidth ?? 128}x${matchedApproved.thumbnailHeight ?? 128}`);
      if (matchedApproved.retinaUrl) variants.push(`${matchedApproved.retinaWidth ?? 960}x${matchedApproved.retinaHeight ?? 960}`);
      if (matchedApproved.hiResUrl) variants.push(`${matchedApproved.hiResWidth ?? 1600}x${matchedApproved.hiResHeight ?? 1600}`);

      rows.push({
        id: target.id,
        name: target.name,
        universalSlug: target.universalSlug,
        category: cat,
        dietary: target.dietary,
        region: target.region,
        status: 'available',
        asset: matchedApproved,
        variantsAvailable: variants,
        fileSizeKb: Math.round((matchedApproved.byteSize || 0) / 1024),
        metadataTags: matchedApproved.acropinMetadata || {
          publisher: 'Acropin Open Food Library',
          universalName: target.universalSlug,
          cleanExif: true,
          schemaVersion: '2.0',
          variantsAvailable: variants,
          license: matchedApproved.licenseType,
          contributorGitHub: matchedApproved.contributorGitHub,
          rightsAttested: matchedApproved.rightsAttested,
          mlVerified: Boolean(
            matchedApproved.mlInspection?.verificationLevel === 'vision-model' &&
            matchedApproved.mlInspection.antiCorruptionPassed
          ),
          timestamp: matchedApproved.createdAt,
        },
        recommendedAiPrompt: aiPrompt,
      });
    } else if (matchedPending) {
      categoryStats[cat].missing++;
      const variants: string[] = [`${matchedPending.width}x${matchedPending.height}`];
      if (matchedPending.thumbnailUrl) variants.unshift(`${matchedPending.thumbnailWidth ?? 128}x${matchedPending.thumbnailHeight ?? 128}`);
      if (matchedPending.retinaUrl) variants.push(`${matchedPending.retinaWidth ?? 960}x${matchedPending.retinaHeight ?? 960}`);
      if (matchedPending.hiResUrl) variants.push(`${matchedPending.hiResWidth ?? 1600}x${matchedPending.hiResHeight ?? 1600}`);

      rows.push({
        id: target.id,
        name: target.name,
        universalSlug: target.universalSlug,
        category: cat,
        dietary: target.dietary,
        region: target.region,
        status: 'in_review',
        asset: matchedPending,
        variantsAvailable: variants,
        fileSizeKb: Math.round((matchedPending.byteSize || 0) / 1024),
        recommendedAiPrompt: aiPrompt,
      });
    } else {
      categoryStats[cat].missing++;
      missingDishes.push({
        ...target,
        recommendedAiPrompt: aiPrompt,
      });

      rows.push({
        id: target.id,
        name: target.name,
        universalSlug: target.universalSlug,
        category: cat,
        dietary: target.dietary,
        region: target.region,
        status: 'missing',
        variantsAvailable: [],
        fileSizeKb: 0,
        recommendedAiPrompt: aiPrompt,
      });
    }
  }

  // Also include any approved catalog assets that might not have been in targetDataset
  for (const asset of approvedAssets) {
    const slug = asset.universalName.toLowerCase();
    const alreadyListed = rows.some((r) => r.universalSlug.toLowerCase() === slug);
    if (!alreadyListed) {
      const variants: string[] = [`${asset.width}x${asset.height}`];
      if (asset.thumbnailUrl) variants.unshift(`${asset.thumbnailWidth ?? 128}x${asset.thumbnailHeight ?? 128}`);
      if (asset.retinaUrl) variants.push(`${asset.retinaWidth ?? 960}x${asset.retinaHeight ?? 960}`);
      if (asset.hiResUrl) variants.push(`${asset.hiResWidth ?? 1600}x${asset.hiResHeight ?? 1600}`);

      rows.push({
        id: asset.id,
        name: asset.dishName,
        universalSlug: asset.universalName,
        category: CANONICAL_DISHES.find((dish) => dish.id === asset.canonicalDishId)?.category ?? 'Uncategorized',
        dietary: CANONICAL_DISHES.find((dish) => dish.id === asset.canonicalDishId)?.dietary ?? 'unknown',
        status: 'available',
        asset,
        variantsAvailable: variants,
        fileSizeKb: Math.round((asset.byteSize || 0) / 1024),
        metadataTags: asset.acropinMetadata,
        recommendedAiPrompt: `Commercial food photography of ${asset.dishName}`,
      });
    }
  }

  const categoryBreakdown: Record<string, { total: number; completed: number; missing: number; percentage: number }> = {};
  for (const [cat, counts] of Object.entries(categoryStats)) {
    categoryBreakdown[cat] = {
      ...counts,
      percentage: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
    };
  }

  const total = rows.length;
  const completed = rows.filter((r) => r.status === 'available').length;
  const missing = rows.filter((r) => r.status === 'missing').length;
  const pending = rows.filter((r) => r.status === 'in_review').length;
  const coveragePercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    totalTargetDishes: total,
    completedCount: completed,
    missingCount: missing,
    pendingCount: pending,
    coveragePercent,
    categoryBreakdown,
    rows,
    completedDishes,
    missingDishes,
  };
}
