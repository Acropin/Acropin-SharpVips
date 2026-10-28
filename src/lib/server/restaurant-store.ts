/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { getAssetById } from './catalog-store.js';
import { readPersistentJson, writePersistentJson } from '../storage/persistent-json.js';
import type {
  MenuItem,
  MenuItemAssignment,
  RestaurantMenu,
} from '../images/types.js';

const RESTAURANTS_DATA_FILE = path.resolve(process.cwd(), './storage/restaurants.json');

let restaurants: RestaurantMenu[] = [];
let isInitialized = false;
let pendingSave: Promise<void> = Promise.resolve();

function ensureStorageDir() {
  const dir = path.dirname(RESTAURANTS_DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveRestaurantsToFile() {
  const snapshot = [...restaurants];
  pendingSave = pendingSave.catch(() => undefined).then(() =>
    writePersistentJson('app-data/restaurants.json', RESTAURANTS_DATA_FILE, snapshot)
  );
}

function loadRestaurantsFromFile() {
  ensureStorageDir();
  if (fs.existsSync(RESTAURANTS_DATA_FILE)) {
    try {
      const raw = fs.readFileSync(RESTAURANTS_DATA_FILE, 'utf-8');
      restaurants = JSON.parse(raw);
    } catch {
      restaurants = [];
    }
  }
}

export async function initializeRestaurants(): Promise<void> {
  if (isInitialized) return;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const savedRestaurants = await readPersistentJson<RestaurantMenu[]>(
        'app-data/restaurants.json',
        RESTAURANTS_DATA_FILE
      );
      restaurants = Array.isArray(savedRestaurants) ? savedRestaurants : [];
    } catch {
      restaurants = [];
    }
  } else {
    loadRestaurantsFromFile();
  }

  if (restaurants.length === 0) {
    const now = new Date().toISOString();

    restaurants = [
      {
        id: 'menu_spice_garden',
        restaurantId: 'rest_spice_garden',
        restaurantName: 'Spice Garden Indian Bistro',
        tagline: 'Artisanal North Indian Curries & Tandoori Specialties',
        cuisine: 'Indian',
        categories: ['Appetizers', 'Mains', 'Rice & Biryani', 'Breads', 'Desserts', 'Beverages'],
        updatedAt: now,
        items: [
          {
            id: 'item_sg_1',
            name: 'Paneer Butter Masala',
            category: 'Mains',
            price: 15.5,
            description: 'Velvety cottage cheese in aromatic tomato, cashew, and churned butter sauce.',
            dietary: 'veg',
            spicyLevel: 1,
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_sg_1',
              restaurantId: 'rest_spice_garden',
              menuItemId: 'item_sg_1',
              imageAssetId: 'asset_paneer_butter_masala_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [
                {
                  action: 'assigned',
                  timestamp: now,
                  actor: 'system_import',
                  newAssetId: 'asset_paneer_butter_masala_1',
                  reason: 'Initial catalog setup exact match',
                },
              ],
            },
          },
          {
            id: 'item_sg_2',
            name: 'Butter Chicken (Murgh Makhani)',
            category: 'Mains',
            price: 17.5,
            description: 'Tandoori grilled chicken steeped in rich tomato cream and fenugreek reduction.',
            dietary: 'non-veg',
            spicyLevel: 1,
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_sg_2',
              restaurantId: 'rest_spice_garden',
              menuItemId: 'item_sg_2',
              imageAssetId: 'asset_butter_chicken_1',
              assignmentMethod: 'automatic_alias',
              matchConfidence: 0.95,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [
                {
                  action: 'assigned',
                  timestamp: now,
                  actor: 'system_import',
                  newAssetId: 'asset_butter_chicken_1',
                },
              ],
            },
          },
          {
            id: 'item_sg_3',
            name: 'Slow-Cooked Dal Makhani',
            category: 'Mains',
            price: 13.0,
            description: 'Classic black lentils and red kidney beans simmered overnight with butter.',
            dietary: 'veg',
            spicyLevel: 1,
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_sg_3',
              restaurantId: 'rest_spice_garden',
              menuItemId: 'item_sg_3',
              imageAssetId: 'asset_dal_makhani_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_sg_4',
            name: 'Hyderabadi Chicken Biryani',
            category: 'Rice & Biryani',
            price: 16.5,
            description: 'Spiced basmati rice layered with juicy chicken, saffron, and fried shallots.',
            dietary: 'non-veg',
            spicyLevel: 2,
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_sg_4',
              restaurantId: 'rest_spice_garden',
              menuItemId: 'item_sg_4',
              imageAssetId: 'asset_chicken_biryani_1',
              assignmentMethod: 'automatic_alias',
              matchConfidence: 0.95,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_sg_5',
            name: 'Garlic Butter Naan',
            category: 'Breads',
            price: 4.5,
            description: 'Oven-baked leavened flatbread scented with freshly crushed roasted garlic.',
            dietary: 'veg',
            spicyLevel: 0,
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_sg_5',
              restaurantId: 'rest_spice_garden',
              menuItemId: 'item_sg_5',
              imageAssetId: 'asset_garlic_naan_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_sg_6',
            name: 'Warm Rose Gulab Jamun',
            category: 'Desserts',
            price: 6.0,
            description: 'Fried milk solid dumplings soaked in green cardamom rose sugar syrup.',
            dietary: 'veg',
            spicyLevel: 0,
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_sg_6',
              restaurantId: 'rest_spice_garden',
              menuItemId: 'item_sg_6',
              imageAssetId: 'asset_gulab_jamun_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_sg_7',
            name: 'Alphonso Mango Lassi',
            category: 'Beverages',
            price: 5.5,
            description: 'Creamy sweet yogurt drink blended with hand-picked Ratnagiri mangoes.',
            dietary: 'veg',
            spicyLevel: 0,
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_sg_7',
              restaurantId: 'rest_spice_garden',
              menuItemId: 'item_sg_7',
              imageAssetId: 'asset_mango_lassi_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_sg_8',
            name: 'Chef Marcus Signature Kebab Platter',
            category: 'Appetizers',
            price: 19.0,
            description: 'Assorted tandoori kebabs with mint chutney. Chef exclusive.',
            dietary: 'non-veg',
            spicyLevel: 2,
            isAvailable: true,
            // Deliberately unassigned item demonstrating placeholder and review workflow!
          },
        ],
      },
      {
        id: 'menu_bella_tavola',
        restaurantId: 'rest_bella_tavola',
        restaurantName: 'Bella Tavola Cucina',
        tagline: 'Authentic Roman Pasta, Woodfired Pizza & Dolci',
        cuisine: 'Italian',
        categories: ['Antipasti', 'Pizza', 'Pasta', 'Dolci'],
        updatedAt: now,
        items: [
          {
            id: 'item_bt_1',
            name: 'Classic Margherita Pizza',
            category: 'Pizza',
            price: 16.0,
            description: 'San Marzano tomatoes, fior di latte mozzarella, fresh basil, and extra virgin olive oil.',
            dietary: 'veg',
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_bt_1',
              restaurantId: 'rest_bella_tavola',
              menuItemId: 'item_bt_1',
              imageAssetId: 'asset_margherita_pizza_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_bt_2',
            name: 'Spicy Pepperoni Pizza',
            category: 'Pizza',
            price: 18.5,
            description: 'Crisp hand-stretched dough with artisanal pepperoni slices and melted mozzarella.',
            dietary: 'non-veg',
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_bt_2',
              restaurantId: 'rest_bella_tavola',
              menuItemId: 'item_bt_2',
              imageAssetId: 'asset_pepperoni_pizza_1',
              assignmentMethod: 'automatic_alias',
              matchConfidence: 0.95,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_bt_3',
            name: 'Spaghetti Carbonara',
            category: 'Pasta',
            price: 19.0,
            description: 'Traditional Roman recipe with crispy guanciale, pecorino romano, egg yolks, black pepper.',
            dietary: 'non-veg',
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_bt_3',
              restaurantId: 'rest_bella_tavola',
              menuItemId: 'item_bt_3',
              imageAssetId: 'asset_carbonara_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_bt_4',
            name: 'Penne all Arrabbiata',
            category: 'Pasta',
            price: 15.0,
            description: 'Al dente penne pasta in a vibrant garlic, fiery chili, and San Marzano tomato pomodoro.',
            dietary: 'vegan',
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_bt_4',
              restaurantId: 'rest_bella_tavola',
              menuItemId: 'item_bt_4',
              imageAssetId: 'asset_penne_arrabbiata_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
          {
            id: 'item_bt_5',
            name: 'Classic Tiramisu',
            category: 'Dolci',
            price: 8.5,
            description: 'Savoiardi ladyfingers steeped in espresso and marsala, layered with whipped mascarpone.',
            dietary: 'veg',
            isAvailable: true,
            imageAssignment: {
              id: 'asgn_bt_5',
              restaurantId: 'rest_bella_tavola',
              menuItemId: 'item_bt_5',
              imageAssetId: 'asset_tiramisu_1',
              assignmentMethod: 'automatic_exact',
              matchConfidence: 1.0,
              assignedAt: now,
              assignedBy: 'system',
              isLocked: false,
              auditTrail: [],
            },
          },
        ],
      },
    ];

    saveRestaurantsToFile();
  }

  isInitialized = true;
  await flushRestaurantStore();
}

export async function flushRestaurantStore(): Promise<void> {
  await pendingSave;
}

export function getAllRestaurants(): Array<{
  id: string;
  name: string;
  cuisine: string;
  tagline: string;
  itemCount: number;
}> {
  initializeRestaurants();
  return restaurants.map((r) => ({
    id: r.restaurantId,
    name: r.restaurantName,
    cuisine: r.cuisine,
    tagline: r.tagline,
    itemCount: r.items.length,
  }));
}

export function getRestaurantMenu(restaurantId: string): RestaurantMenu | undefined {
  initializeRestaurants();
  const menu = restaurants.find((r) => r.restaurantId === restaurantId);
  if (!menu) return undefined;

  // Resolve public image URLs and check for revoked assets
  const itemsWithResolvedAssets = menu.items.map((item) => {
    let resolvedUrl: string | undefined;
    let attribution: string | undefined;
    let isRevokedFallback = false;

    if (item.imageAssignment?.imageAssetId) {
      const asset = getAssetById(item.imageAssignment.imageAssetId);
      if (asset) {
        if (asset.approvalStatus === 'revoked') {
          // Flagged fallback: revoked assets are NOT served to customers
          isRevokedFallback = true;
          resolvedUrl = undefined;
        } else if (asset.approvalStatus === 'approved') {
          resolvedUrl = asset.publicUrl;
          attribution = asset.requiredAttribution;
        }
      }
    }

    return {
      ...item,
      resolvedImageUrl: resolvedUrl,
      attribution,
      imageAssignment: item.imageAssignment
        ? {
            ...item.imageAssignment,
            isRevokedFallback,
          }
        : undefined,
    };
  });

  return {
    ...menu,
    items: itemsWithResolvedAssets,
  };
}

export function updateMenuItemAssignment(
  restaurantId: string,
  menuItemId: string,
  newAssetId: string | null,
  assignedBy = 'restaurant_owner'
): MenuItem | undefined {
  initializeRestaurants();
  const menu = restaurants.find((r) => r.restaurantId === restaurantId);
  if (!menu) return undefined;

  const item = menu.items.find((i) => i.id === menuItemId);
  if (!item) return undefined;

  const now = new Date().toISOString();
  const prevAssetId = item.imageAssignment?.imageAssetId;

  if (newAssetId === null) {
    // Unassign image
    item.imageAssignment = undefined;
    item.resolvedImageUrl = undefined;
  } else {
    const asset = getAssetById(newAssetId);
    if (!asset) {
      throw new Error(`Asset ID "${newAssetId}" does not exist in catalog.`);
    }

    const auditEntry = {
      action: 'reassigned' as const,
      timestamp: now,
      actor: assignedBy,
      previousAssetId: prevAssetId,
      newAssetId,
      reason: 'Manual owner selection from Image Library',
    };

    const existingAudit = item.imageAssignment?.auditTrail || [];

    item.imageAssignment = {
      id: item.imageAssignment?.id || `asgn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      restaurantId,
      menuItemId,
      imageAssetId: newAssetId,
      assignmentMethod: 'manual_owner',
      matchConfidence: 1.0,
      assignedAt: now,
      assignedBy,
      isLocked: true, // Locking prevents auto-import from overwriting manual choices!
      isRevokedFallback: asset.approvalStatus === 'revoked',
      auditTrail: [...existingAudit, auditEntry],
    };

    item.resolvedImageUrl = asset.approvalStatus === 'approved' ? asset.publicUrl : undefined;
    item.attribution = asset.requiredAttribution;
  }

  menu.updatedAt = now;
  saveRestaurantsToFile();
  return item;
}

export function saveRestaurantMenu(menu: RestaurantMenu): void {
  initializeRestaurants();
  const idx = restaurants.findIndex((r) => r.restaurantId === menu.restaurantId);
  if (idx >= 0) {
    restaurants[idx] = menu;
  } else {
    restaurants.push(menu);
  }
  saveRestaurantsToFile();
}

/**
 * Revoke asset and find all affected restaurant menu items across all tenants.
 */
export function handleAssetRevocation(revokedAssetId: string): {
  affectedItems: Array<{ restaurantId: string; restaurantName: string; itemId: string; itemName: string }>;
} {
  initializeRestaurants();
  const affected: Array<{
    restaurantId: string;
    restaurantName: string;
    itemId: string;
    itemName: string;
  }> = [];

  for (const menu of restaurants) {
    for (const item of menu.items) {
      if (item.imageAssignment?.imageAssetId === revokedAssetId) {
        item.imageAssignment.isRevokedFallback = true;
        item.imageAssignment.auditTrail.push({
          action: 'revoked_fallback',
          timestamp: new Date().toISOString(),
          actor: 'security_governance',
          previousAssetId: revokedAssetId,
          reason: 'Asset license was revoked by catalog governance',
        });
        affected.push({
          restaurantId: menu.restaurantId,
          restaurantName: menu.restaurantName,
          itemId: item.id,
          itemName: item.name,
        });
      }
    }
  }

  if (affected.length > 0) {
    saveRestaurantsToFile();
  }

  return { affectedItems: affected };
}
