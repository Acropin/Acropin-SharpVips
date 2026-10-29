/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { readPersistentJson, writePersistentJson } from '../storage/persistent-json.js';
import { toUniversalFoodName } from '../images/universal-naming.js';
import type { DatasetTargetItem, ImageAsset, DishDietary, AcropinMetadataTags } from '../images/types.js';

const TARGETS_DATA_FILE = path.resolve(process.cwd(), './storage/dataset-targets.json');

let targetDataset: DatasetTargetItem[] = [];
let isInitialized = false;
let initializePromise: Promise<void> | null = null;
let pendingSave: Promise<void> = Promise.resolve();

// Standard universal food catalog targets for restaurant menus (no regional bias or dummy data)
const UNIVERSAL_STANDARD_TARGETS: Omit<DatasetTargetItem, 'id' | 'universalSlug' | 'createdAt'>[] = [
  { name: 'Margherita Pizza', region: 'Italian', category: 'Mains', dietary: 'veg' },
  { name: 'Classic Cheeseburger', region: 'American', category: 'Mains', dietary: 'non-veg' },
  { name: 'Tonkotsu Ramen', region: 'Japanese', category: 'Mains', dietary: 'non-veg' },
  { name: 'Caesar Salad', region: 'Salads', category: 'Appetizers', dietary: 'veg' },
  { name: 'Spaghetti Carbonara', region: 'Italian', category: 'Mains', dietary: 'non-veg' },
  { name: 'Crispy French Fries', region: 'Sides', category: 'Sides', dietary: 'vegan' },
  { name: 'Grilled Atlantic Salmon', region: 'Seafood', category: 'Mains', dietary: 'non-veg' },
  { name: 'Chicken Biryani', region: 'Rice & Grains', category: 'Mains', dietary: 'non-veg' },
  { name: 'Classic Tiramisu', region: 'Bakery', category: 'Desserts', dietary: 'veg' },
  { name: 'Chocolate Fudge Brownie', region: 'Bakery', category: 'Desserts', dietary: 'veg' },
  { name: 'Cappuccino', region: 'Coffee', category: 'Beverages', dietary: 'veg' },
  { name: 'Fresh Guacamole & Chips', region: 'Mexican', category: 'Appetizers', dietary: 'vegan' },
  { name: 'Crispy Street Tacos', region: 'Mexican', category: 'Mains', dietary: 'non-veg' },
  { name: 'Greek Salad', region: 'Mediterranean', category: 'Appetizers', dietary: 'veg' },
  { name: 'Triple Decker Club Sandwich', region: 'Deli', category: 'Mains', dietary: 'non-veg' },
  { name: 'Tom Yum Soup', region: 'Thai', category: 'Appetizers', dietary: 'non-veg' },
  { name: 'Mango Smoothie', region: 'Beverages', category: 'Beverages', dietary: 'veg' },
  { name: 'Butter Croissant', region: 'Bakery', category: 'Sides', dietary: 'veg' },
];

function saveTargetsToFile() {
  pendingSave = pendingSave.catch(() => undefined).then(() =>
    writePersistentJson('app-data/dataset-targets.json', TARGETS_DATA_FILE, targetDataset)
  );
}

export async function initializeTargetDataset(): Promise<void> {
  if (isInitialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      try {
        const stored = await readPersistentJson<DatasetTargetItem[]>(
          'app-data/dataset-targets.json',
          TARGETS_DATA_FILE
        );
        if (Array.isArray(stored) && stored.length > 0) {
          targetDataset = stored;
        } else {
          // Initialize with standard universal menu items
          const now = new Date().toISOString();
          targetDataset = UNIVERSAL_STANDARD_TARGETS.map((dish) => {
            const universal = toUniversalFoodName(dish.name);
            return {
              id: `target_${universal.universalName}`,
              name: dish.name,
              universalSlug: universal.universalName,
              region: dish.region || 'Universal',
              category: dish.category || 'Mains',
              dietary: dish.dietary,
              createdAt: now,
            };
          });
          saveTargetsToFile();
        }
      } catch {
        targetDataset = [];
      }
      isInitialized = true;
    })();
  }
  await initializePromise;
}

export async function flushTargets(): Promise<void> {
  await pendingSave;
}

export function getAllTargetItems(): DatasetTargetItem[] {
  initializeTargetDataset();
  return [...targetDataset];
}

export function addTargetItem(
  name: string,
  category = 'Mains',
  dietary: DishDietary = 'veg',
  region = 'Universal',
  notes?: string
): DatasetTargetItem {
  initializeTargetDataset();
  const universal = toUniversalFoodName(name);
  const existingIdx = targetDataset.findIndex(
    (t) => t.universalSlug === universal.universalName || t.name.toLowerCase() === name.toLowerCase()
  );

  const item: DatasetTargetItem = {
    id: `target_${universal.universalName}`,
    name: universal.displayName,
    universalSlug: universal.universalName,
    region: (region || 'Universal').trim(),
    category: (category || 'Mains').trim(),
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
 * Format of each row: { name, category?, dietary?, region?, notes? }
 */
export function bulkImportTargets(
  items: Array<{ name: string; category?: string; dietary?: string; region?: string; notes?: string }>,
  replaceExisting = false
): { added: number; total: number } {
  initializeTargetDataset();
  if (replaceExisting) {
    targetDataset = [];
  }

  let addedCount = 0;
  for (const raw of items) {
    if (!raw.name || typeof raw.name !== 'string' || !raw.name.trim()) continue;
    const universal = toUniversalFoodName(raw.name);
    const existing = targetDataset.find((t) => t.universalSlug === universal.universalName);
    if (!existing) {
      targetDataset.push({
        id: `target_${universal.universalName}`,
        name: universal.displayName,
        universalSlug: universal.universalName,
        region: (raw.region || 'Universal').trim(),
        category: (raw.category || 'Mains').trim(),
        dietary: (['veg', 'non-veg', 'vegan'].includes(String(raw.dietary))
          ? raw.dietary
          : 'veg') as DishDietary,
        notes: raw.notes ? String(raw.notes).trim() : undefined,
        createdAt: new Date().toISOString(),
      });
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
  dietary: DishDietary;
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
    const cat = target.category || 'Mains';
    if (!categoryStats[cat]) {
      categoryStats[cat] = { total: 0, completed: 0, missing: 0 };
    }
    categoryStats[cat].total++;

    const matchedApproved =
      approvedMap.get(target.universalSlug.toLowerCase()) ||
      approvedMap.get(target.id.toLowerCase());

    const matchedPending = pendingMap.get(target.universalSlug.toLowerCase());

    // Prompt specifically crafted for contributors using ChatGPT / AI models
    const aiPrompt = `Award-winning commercial food photograph of ${target.name}, perfectly plated on authentic tableware, natural diffused studio lighting, shallow depth of field, 8k resolution, crisp detail, restaurant menu presentation, clean background, no text, no watermark.`;

    if (matchedApproved) {
      categoryStats[cat].completed++;
      completedDishes.push({
        ...target,
        asset: matchedApproved,
      });

      const variants: string[] = ['480x480'];
      if (matchedApproved.thumbnailUrl) variants.unshift('128x128');
      if (matchedApproved.retinaUrl) variants.push('960x960');
      if (matchedApproved.hiResUrl) variants.push('1600x1600');

      rows.push({
        id: target.id,
        name: target.name,
        universalSlug: target.universalSlug,
        category: cat,
        dietary: target.dietary,
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
          license: matchedApproved.licenseType || 'CC0',
          contributorGitHub: matchedApproved.contributorGitHub,
          dcoSignOff: matchedApproved.dcoSignOff,
          mlVerified: Boolean(matchedApproved.mlInspection?.antiCorruptionPassed),
          timestamp: matchedApproved.createdAt,
        },
        recommendedAiPrompt: aiPrompt,
      });
    } else if (matchedPending) {
      categoryStats[cat].missing++;
      const variants: string[] = ['480x480'];
      if (matchedPending.thumbnailUrl) variants.unshift('128x128');
      if (matchedPending.retinaUrl) variants.push('960x960');
      if (matchedPending.hiResUrl) variants.push('1600x1600');

      rows.push({
        id: target.id,
        name: target.name,
        universalSlug: target.universalSlug,
        category: cat,
        dietary: target.dietary,
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
      const variants: string[] = ['480x480'];
      if (asset.thumbnailUrl) variants.unshift('128x128');
      if (asset.retinaUrl) variants.push('960x960');
      if (asset.hiResUrl) variants.push('1600x1600');

      rows.push({
        id: asset.id,
        name: asset.dishName,
        universalSlug: asset.universalName,
        category: 'Uncategorized',
        dietary: 'veg',
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
