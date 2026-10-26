/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { processFoodImage } from '../images/process-image';
import { buildVersionedStorageKey, getStorageProvider } from '../storage/image-storage';
import type { AssetApprovalStatus, ImageAsset, LicenseType } from '../images/types';

const CATALOG_DATA_FILE = path.resolve(process.cwd(), './storage/catalog.json');

// In-memory cache backed by JSON file persistence
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
      assetCatalog = JSON.parse(raw);
    } catch {
      assetCatalog = [];
    }
  }
}

/**
 * Creates an appetizing synthetic SVG canvas representing a food dish,
 * used to bootstrap the seed catalog through the real Sharp processing pipeline.
 */
function createSyntheticFoodSvg(
  dishName: string,
  cuisine: string,
  dietary: 'veg' | 'non-veg' | 'vegan',
  primaryColor: string,
  secondaryColor: string,
  iconEmoji: string
): Buffer {
  const dietaryBadge = dietary === 'veg' ? '#10b981' : dietary === 'vegan' ? '#059669' : '#ef4444';
  const dietaryText = dietary.toUpperCase();

  const svg = `
  <svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${primaryColor}"/>
        <stop offset="100%" stop-color="${secondaryColor}"/>
      </linearGradient>
      <radialGradient id="plate" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
        <stop offset="70%" stop-color="#f8fafc" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#cbd5e1" stop-opacity="0.8"/>
      </radialGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="16" stdDeviation="20" flood-opacity="0.25"/>
      </filter>
    </defs>

    <!-- Warm Atmospheric Background -->
    <rect width="800" height="800" fill="url(#bg)"/>

    <!-- Ceramic Plate with Shadow -->
    <circle cx="400" cy="400" r="280" fill="url(#plate)" filter="url(#shadow)"/>
    <circle cx="400" cy="400" r="250" fill="none" stroke="#e2e8f0" stroke-width="4"/>

    <!-- Food Graphic / Emoji Accent -->
    <text x="400" y="380" font-size="140" text-anchor="middle" dominant-baseline="central">${iconEmoji}</text>

    <!-- Dish Title Plaque -->
    <rect x="150" y="520" width="500" height="70" rx="35" fill="#1e293b" opacity="0.9"/>
    <text x="400" y="563" font-family="system-ui, sans-serif" font-weight="bold" font-size="28" fill="#ffffff" text-anchor="middle">
      ${dishName}
    </text>

    <!-- Dietary & Cuisine Pill -->
    <rect x="220" y="605" width="360" height="42" rx="21" fill="#ffffff" opacity="0.95"/>
    <circle cx="245" cy="626" r="8" fill="${dietaryBadge}"/>
    <text x="265" y="633" font-family="system-ui, sans-serif" font-weight="600" font-size="16" fill="#334155">
      ${dietaryText} • ${cuisine}
    </text>
  </svg>
  `;

  return Buffer.from(svg);
}

/**
 * Initialize catalog and seed core canonical assets if empty.
 */
export async function initializeCatalog(): Promise<void> {
  if (isInitialized) return;
  loadCatalogFromFile();

  if (assetCatalog.length === 0) {
    const storage = getStorageProvider();

    const seedEntries: Array<{
      id: string;
      dishId: string;
      dishName: string;
      cuisine: string;
      dietary: 'veg' | 'non-veg' | 'vegan';
      primaryColor: string;
      secondaryColor: string;
      emoji: string;
      licenseType: LicenseType;
      attribution: string;
      evidence: string;
    }> = [
      {
        id: 'asset_paneer_butter_masala_1',
        dishId: 'dish_paneer_butter_masala',
        dishName: 'Paneer Butter Masala',
        cuisine: 'North Indian',
        dietary: 'veg',
        primaryColor: '#c2410c',
        secondaryColor: '#f97316',
        emoji: '🧀',
        licenseType: 'Studio-Acropin-Proprietary',
        attribution: 'Acropin Culinary Studio (Commercial Exclusive)',
        evidence: 'acropin://licensing/assets/paneer_butter_masala_v1',
      },
      {
        id: 'asset_butter_chicken_1',
        dishId: 'dish_butter_chicken',
        dishName: 'Butter Chicken',
        cuisine: 'North Indian',
        dietary: 'non-veg',
        primaryColor: '#b91c1c',
        secondaryColor: '#ea580c',
        emoji: '🍗',
        licenseType: 'CC-BY-4.0',
        attribution: 'Photo by Chef Marcus (CC-BY-4.0)',
        evidence: 'https://creativecommons.org/licenses/by/4.0/',
      },
      {
        id: 'asset_dal_makhani_1',
        dishId: 'dish_dal_makhani',
        dishName: 'Dal Makhani',
        cuisine: 'North Indian',
        dietary: 'veg',
        primaryColor: '#451a03',
        secondaryColor: '#78350f',
        emoji: '🍲',
        licenseType: 'CC0',
        attribution: 'Acropin Open Food Media',
        evidence: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      {
        id: 'asset_chicken_biryani_1',
        dishId: 'dish_chicken_biryani',
        dishName: 'Chicken Biryani',
        cuisine: 'Indian',
        dietary: 'non-veg',
        primaryColor: '#854d0e',
        secondaryColor: '#eab308',
        emoji: '🍚',
        licenseType: 'Unsplash-Commercial',
        attribution: 'Unsplash Commercial Food Project',
        evidence: 'https://unsplash.com/license',
      },
      {
        id: 'asset_veg_biryani_1',
        dishId: 'dish_veg_biryani',
        dishName: 'Vegetable Biryani',
        cuisine: 'Indian',
        dietary: 'veg',
        primaryColor: '#15803d',
        secondaryColor: '#84cc16',
        emoji: '🥗',
        licenseType: 'CC-BY-4.0',
        attribution: 'Spice Kitchen Archives',
        evidence: 'https://creativecommons.org/licenses/by/4.0/',
      },
      {
        id: 'asset_garlic_naan_1',
        dishId: 'dish_garlic_naan',
        dishName: 'Garlic Naan',
        cuisine: 'North Indian',
        dietary: 'veg',
        primaryColor: '#713f12',
        secondaryColor: '#ca8a04',
        emoji: '🫓',
        licenseType: 'CC0',
        attribution: 'Public Domain Culinary Works',
        evidence: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      {
        id: 'asset_samosa_1',
        dishId: 'dish_samosa',
        dishName: 'Vegetable Samosa',
        cuisine: 'Indian',
        dietary: 'vegan',
        primaryColor: '#d97706',
        secondaryColor: '#f59e0b',
        emoji: '🥟',
        licenseType: 'Studio-Acropin-Proprietary',
        attribution: 'Acropin Culinary Studio',
        evidence: 'acropin://licensing/assets/samosa_v1',
      },
      {
        id: 'asset_gulab_jamun_1',
        dishId: 'dish_gulab_jamun',
        dishName: 'Gulab Jamun',
        cuisine: 'Indian',
        dietary: 'veg',
        primaryColor: '#831843',
        secondaryColor: '#db2777',
        emoji: '🍯',
        licenseType: 'CC0',
        attribution: 'Heritage Sweets Collection',
        evidence: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      {
        id: 'asset_margherita_pizza_1',
        dishId: 'dish_margherita_pizza',
        dishName: 'Margherita Pizza',
        cuisine: 'Italian',
        dietary: 'veg',
        primaryColor: '#991b1b',
        secondaryColor: '#dc2626',
        emoji: '🍕',
        licenseType: 'Studio-Acropin-Proprietary',
        attribution: 'Acropin Artisan Pizzaiolo',
        evidence: 'acropin://licensing/assets/margherita_v1',
      },
      {
        id: 'asset_pepperoni_pizza_1',
        dishId: 'dish_pepperoni_pizza',
        dishName: 'Pepperoni Pizza',
        cuisine: 'Italian-American',
        dietary: 'non-veg',
        primaryColor: '#7f1d1d',
        secondaryColor: '#b91c1c',
        emoji: '🍕',
        licenseType: 'CC-BY-4.0',
        attribution: 'Napoli Woodfire Guild',
        evidence: 'https://creativecommons.org/licenses/by/4.0/',
      },
      {
        id: 'asset_carbonara_1',
        dishId: 'dish_spaghetti_carbonara',
        dishName: 'Spaghetti Carbonara',
        cuisine: 'Italian',
        dietary: 'non-veg',
        primaryColor: '#a16207',
        secondaryColor: '#eab308',
        emoji: '🍝',
        licenseType: 'Studio-Acropin-Proprietary',
        attribution: 'Trattoria Romana Series',
        evidence: 'acropin://licensing/assets/carbonara_v1',
      },
      {
        id: 'asset_penne_arrabbiata_1',
        dishId: 'dish_penne_arrabbiata',
        dishName: 'Penne all Arrabbiata',
        cuisine: 'Italian',
        dietary: 'vegan',
        primaryColor: '#991b1b',
        secondaryColor: '#f97316',
        emoji: '🍝',
        licenseType: 'CC0',
        attribution: 'Cucina Povera Project',
        evidence: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      {
        id: 'asset_tiramisu_1',
        dishId: 'dish_tiramisu',
        dishName: 'Classic Tiramisu',
        cuisine: 'Italian',
        dietary: 'veg',
        primaryColor: '#3b0764',
        secondaryColor: '#6b21a8',
        emoji: '🍰',
        licenseType: 'Studio-Acropin-Proprietary',
        attribution: 'Pastry Masterworks',
        evidence: 'acropin://licensing/assets/tiramisu_v1',
      },
      {
        id: 'asset_pad_thai_1',
        dishId: 'dish_pad_thai',
        dishName: 'Pad Thai Noodles',
        cuisine: 'Thai',
        dietary: 'non-veg',
        primaryColor: '#c2410c',
        secondaryColor: '#ea580c',
        emoji: '🍜',
        licenseType: 'CC-BY-4.0',
        attribution: 'Bangkok Street Food Library',
        evidence: 'https://creativecommons.org/licenses/by/4.0/',
      },
      {
        id: 'asset_tonkotsu_ramen_1',
        dishId: 'dish_tonkotsu_ramen',
        dishName: 'Tonkotsu Ramen',
        cuisine: 'Japanese',
        dietary: 'non-veg',
        primaryColor: '#1e293b',
        secondaryColor: '#475569',
        emoji: '🍜',
        licenseType: 'Studio-Acropin-Proprietary',
        attribution: 'Tokyo Noodle Guild',
        evidence: 'acropin://licensing/assets/ramen_v1',
      },
      {
        id: 'asset_cheeseburger_1',
        dishId: 'dish_classic_cheeseburger',
        dishName: 'Classic Cheeseburger',
        cuisine: 'American',
        dietary: 'non-veg',
        primaryColor: '#78350f',
        secondaryColor: '#b45309',
        emoji: '🍔',
        licenseType: 'Unsplash-Commercial',
        attribution: 'Diner Craft Photo Lab',
        evidence: 'https://unsplash.com/license',
      },
      {
        id: 'asset_caesar_salad_1',
        dishId: 'dish_caesar_salad',
        dishName: 'Caesar Salad',
        cuisine: 'Continental',
        dietary: 'veg',
        primaryColor: '#14532d',
        secondaryColor: '#16a34a',
        emoji: '🥗',
        licenseType: 'CC0',
        attribution: 'Green Leaf Commons',
        evidence: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      {
        id: 'asset_mango_lassi_1',
        dishId: 'dish_mango_lassi',
        dishName: 'Mango Lassi',
        cuisine: 'Indian',
        dietary: 'veg',
        primaryColor: '#ca8a04',
        secondaryColor: '#facc15',
        emoji: '🥭',
        licenseType: 'Studio-Acropin-Proprietary',
        attribution: 'Acropin Beverages',
        evidence: 'acropin://licensing/assets/mango_lassi_v1',
      },
    ];

    for (const item of seedEntries) {
      try {
        const svgBuffer = createSyntheticFoodSvg(
          item.dishName,
          item.cuisine,
          item.dietary,
          item.primaryColor,
          item.secondaryColor,
          item.emoji
        );

        // Convert synthetic SVG to PNG buffer first
        const pngBuffer = await sharp(svgBuffer).png().toBuffer();

        // Process through real Sharp pipeline to get genuine 480x480 WebP, sRGB, hash, and metadata
        const processed = await processFoodImage(pngBuffer, {
          width: 480,
          height: 480,
          initialQuality: 78,
          effort: 5,
        });

        const storageKey = buildVersionedStorageKey(item.id, 1);
        const uploadResult = await storage.upload(storageKey, processed.buffer, 'image/webp');

        const now = new Date().toISOString();
        assetCatalog.push({
          id: item.id,
          canonicalDishId: item.dishId,
          dishName: item.dishName,
          storageKey,
          publicUrl: uploadResult.url,
          sha256Hash: processed.hash,
          width: 480,
          height: 480,
          format: 'webp',
          byteSize: processed.byteSize,
          sourceProvider: 'Acropin Studio',
          licenseType: item.licenseType,
          licenseEvidence: item.evidence,
          requiredAttribution: item.attribution,
          processingVersion: 'v1',
          processingQuality: processed.qualityUsed,
          focalPoint: { x: 0.5, y: 0.5 },
          approvalStatus: 'approved',
          createdAt: now,
          updatedAt: now,
          tags: [item.cuisine.toLowerCase(), item.dietary, 'seed-catalog'],
        });
      } catch (err) {
        console.error(`Failed to process seed asset for ${item.dishName}:`, err);
      }
    }

    saveCatalogToFile();
  }

  isInitialized = true;
}

export function getAllAssets(filter?: {
  status?: AssetApprovalStatus;
  search?: string;
  dishId?: string;
}): ImageAsset[] {
  let list = [...assetCatalog];

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
        a.tags.some((t) => t.toLowerCase().includes(q)) ||
        (a.requiredAttribution && a.requiredAttribution.toLowerCase().includes(q))
    );
  }

  return list;
}

export function getAssetById(id: string): ImageAsset | undefined {
  return assetCatalog.find((a) => a.id === id);
}

export function findAssetByHash(hash: string): ImageAsset | undefined {
  return assetCatalog.find((a) => a.sha256Hash === hash);
}

export function registerAsset(asset: ImageAsset): ImageAsset {
  const existingIdx = assetCatalog.findIndex((a) => a.id === asset.id);
  if (existingIdx >= 0) {
    assetCatalog[existingIdx] = asset;
  } else {
    assetCatalog.unshift(asset);
  }
  saveCatalogToFile();
  return asset;
}

export interface RevocationReport {
  assetId: string;
  previousStatus: AssetApprovalStatus;
  newStatus: AssetApprovalStatus;
  affectedRestaurantsCount: number;
  affectedItemsCount: number;
}

export function updateAssetStatus(
  assetId: string,
  newStatus: AssetApprovalStatus,
  reason?: string
): ImageAsset | undefined {
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
