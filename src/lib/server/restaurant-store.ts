/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAssetById } from './catalog-store.js';
import { getAppDataFile } from '../storage/data-directory.js';
import { isPersistentStorageWritable, readPersistentJson, writePersistentJson } from '../storage/persistent-json.js';
import type {
  MenuItem,
  RestaurantMenu,
} from '../images/types.js';

const restaurantsDataFile = () => getAppDataFile('restaurants.json');

let restaurants: RestaurantMenu[] = [];
let isInitialized = false;
let initializePromise: Promise<void> | null = null;
let pendingSave: Promise<void> = Promise.resolve();

function saveRestaurantsToFile() {
  const snapshot = [...restaurants];
  pendingSave = pendingSave.catch(() => undefined).then(() =>
    writePersistentJson('app-data/restaurants.json', restaurantsDataFile(), snapshot)
  );
}

function isRestaurantMenu(value: unknown): value is RestaurantMenu {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const menu = value as Partial<RestaurantMenu>;
  return (
    typeof menu.id === 'string' &&
    typeof menu.restaurantId === 'string' &&
    typeof menu.restaurantName === 'string' &&
    typeof menu.cuisine === 'string' &&
    typeof menu.updatedAt === 'string' &&
    Array.isArray(menu.items)
  );
}

function isLegacyDemoRestaurant(menu: RestaurantMenu): boolean {
  return (
    menu.id === 'menu_spice_garden' ||
    menu.id === 'menu_bella_tavola' ||
    menu.restaurantId === 'rest_spice_garden' ||
    menu.restaurantId === 'rest_bella_tavola' ||
    /^menu_rest_test_\d+$/u.test(menu.id) ||
    /^rest_test_\d+$/u.test(menu.restaurantId)
  );
}

export async function initializeRestaurants(): Promise<void> {
  if (isInitialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      const stored = await readPersistentJson<unknown>(
        'app-data/restaurants.json',
        restaurantsDataFile()
      );

      if (stored === null) {
        restaurants = [];
      } else if (!Array.isArray(stored) || !stored.every(isRestaurantMenu)) {
        throw new Error('Restaurant storage is invalid. Fix the stored data before accepting menu changes.');
      } else {
        const savedRestaurants = stored as RestaurantMenu[];
        restaurants = savedRestaurants.filter((menu) => !isLegacyDemoRestaurant(menu));

        if (restaurants.length !== savedRestaurants.length && isPersistentStorageWritable()) {
          try {
            saveRestaurantsToFile();
            await flushRestaurantStore();
          } catch (error) {
            console.error('Could not persist the restaurant cleanup; continuing with the loaded snapshot.', error instanceof Error ? error.name : 'UnknownError');
          }
        }
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
