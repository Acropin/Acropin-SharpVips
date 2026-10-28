/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { matchCanonicalDish } from '../catalog/matcher.js';
import { getAllAssets, getAssetById } from '../server/catalog-store.js';
import { getRestaurantMenu, saveRestaurantMenu } from '../server/restaurant-store.js';
import type {
  DishDietary,
  ImageAsset,
  ImportPreviewItem,
  ImportSummary,
  MenuItem,
  MenuItemAssignment,
  RestaurantMenu,
} from '../images/types.js';

export interface RawMenuItemInput {
  id?: string;
  name: string;
  category?: string;
  price: number;
  description?: string;
  dietary?: DishDietary;
  spicyLevel?: number;
  isAvailable?: boolean;
}

export interface RawMenuJsonInput {
  restaurantName?: string;
  cuisine?: string;
  tagline?: string;
  categories?: string[];
  items?: RawMenuItemInput[];
  sections?: Array<{
    category: string;
    items: RawMenuItemInput[];
  }>;
}

/**
 * Normalizes raw input from either flat items array or hierarchical sections array.
 */
export function normalizeMenuInput(raw: unknown): RawMenuItemInput[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Menu import payload must be a valid JSON object or array.');
  }

  // Case 1: Array of items directly
  if (Array.isArray(raw)) {
    return raw.map((item, idx) => validateRawItem(item, idx));
  }

  const obj = raw as RawMenuJsonInput;

  // Case 2: { items: [...] }
  if (Array.isArray(obj.items)) {
    return obj.items.map((item, idx) => validateRawItem(item, idx));
  }

  // Case 3: { sections: [{ category: '...', items: [...] }] }
  if (Array.isArray(obj.sections)) {
    const flattened: RawMenuItemInput[] = [];
    let idx = 0;
    for (const section of obj.sections) {
      const category = section.category || 'Mains';
      if (Array.isArray(section.items)) {
        for (const item of section.items) {
          flattened.push(validateRawItem({ ...item, category: item.category || category }, idx++));
        }
      }
    }
    return flattened;
  }

  throw new Error(
    'Unrecognized menu JSON structure. Expected a list of items or an object with "items" or "sections".'
  );
}

function validateRawItem(item: unknown, index: number): RawMenuItemInput {
  if (!item || typeof item !== 'object') {
    throw new Error(`Item at index ${index} is not an object.`);
  }
  const i = item as Record<string, unknown>;
  const name = typeof i.name === 'string' ? i.name.trim() : '';
  if (!name) {
    throw new Error(`Item at index ${index} is missing a required "name" field.`);
  }

  const price = typeof i.price === 'number' ? i.price : Number(i.price) || 0;
  const category = typeof i.category === 'string' ? i.category.trim() : 'Mains';
  const description = typeof i.description === 'string' ? i.description.trim() : '';
  const dietary = (['veg', 'non-veg', 'vegan'].includes(String(i.dietary))
    ? i.dietary
    : undefined) as DishDietary | undefined;

  return {
    id: typeof i.id === 'string' ? i.id : undefined,
    name,
    category,
    price,
    description,
    dietary,
    spicyLevel: typeof i.spicyLevel === 'number' ? i.spicyLevel : 0,
    isAvailable: i.isAvailable !== false,
  };
}

/**
 * Preview menu import:
 * - Validates input items
 * - Identifies existing items in restaurant menu
 * - Preserves existing assignments (especially manual locks)
 * - Runs canonical dish matcher on new/unassigned items
 * - Returns preview with match status and proposed image
 */
export function generateImportPreview(
  restaurantId: string,
  rawJson: unknown
): {
  restaurantId: string;
  restaurantName: string;
  previewItems: ImportPreviewItem[];
  proposedCategories: string[];
} {
  const items = normalizeMenuInput(rawJson);
  const existingMenu = getRestaurantMenu(restaurantId);
  const restaurantName = existingMenu?.restaurantName || 'Restaurant';

  const approvedAssets = getAllAssets({ status: 'approved' });
  const categorySet = new Set<string>();

  const previewItems: ImportPreviewItem[] = items.map((inputItem, index) => {
    categorySet.add(inputItem.category || 'Mains');

    // Check for existing item match by ID or by exact name in current restaurant menu
    const existingItem = existingMenu?.items.find(
      (item) => (inputItem.id && item.id === inputItem.id) || item.name.toLowerCase() === inputItem.name.toLowerCase()
    );

    const generatedItemId = inputItem.id || existingItem?.id || `item_${Date.now()}_${index}`;

    // RULE: If item already has a manual locked assignment, ALWAYS preserve it
    if (existingItem?.imageAssignment?.isLocked) {
      const lockedAsset = existingItem.imageAssignment.imageAssetId
        ? getAssetById(existingItem.imageAssignment.imageAssetId)
        : undefined;

      return {
        id: generatedItemId,
        name: inputItem.name,
        category: inputItem.category || 'Mains',
        price: inputItem.price,
        description: inputItem.description || '',
        dietary: inputItem.dietary,
        status: 'manual_locked',
        proposedAsset: lockedAsset,
        existingAssetId: existingItem.imageAssignment.imageAssetId,
        isLocked: true,
      };
    }

    // RULE: If existing item has an active approved assignment, PRESERVE IT across re-imports
    if (existingItem?.imageAssignment?.imageAssetId) {
      const currentAsset = getAssetById(existingItem.imageAssignment.imageAssetId);
      if (currentAsset && currentAsset.approvalStatus === 'approved') {
        return {
          id: generatedItemId,
          name: inputItem.name,
          category: inputItem.category || 'Mains',
          price: inputItem.price,
          description: inputItem.description || '',
          dietary: inputItem.dietary,
          status: 'preserved_existing',
          proposedAsset: currentAsset,
          existingAssetId: existingItem.imageAssignment.imageAssetId,
          isLocked: false,
        };
      }
    }

    // Run canonical matcher
    const match = matchCanonicalDish(inputItem.name, {
      category: inputItem.category,
      dietary: inputItem.dietary,
      description: inputItem.description,
    });

    if (match.canonicalDish && match.confidence >= 0.85 && !match.requiresReview) {
      // Find suitable approved asset for this canonical dish
      const asset =
        approvedAssets.find((a) => a.canonicalDishId === match.canonicalDish?.id) ||
        approvedAssets.find((a) => a.id === match.canonicalDish?.suitableAssetIds[0]);

      if (asset) {
        return {
          id: generatedItemId,
          name: inputItem.name,
          category: inputItem.category || 'Mains',
          price: inputItem.price,
          description: inputItem.description || '',
          dietary: inputItem.dietary,
          status: 'new_assignment',
          canonicalMatch: {
            dishId: match.canonicalDish.id,
            dishName: match.canonicalDish.canonicalName,
            confidence: match.confidence,
            matchType: match.matchType,
          },
          proposedAsset: asset,
          isLocked: false,
        };
      }
    }

    if (match.canonicalDish && match.confidence >= 0.60) {
      // Ambiguous candidate match
      const candidateAsset = approvedAssets.find((a) => a.canonicalDishId === match.canonicalDish?.id);
      return {
        id: generatedItemId,
        name: inputItem.name,
        category: inputItem.category || 'Mains',
        price: inputItem.price,
        description: inputItem.description || '',
        dietary: inputItem.dietary,
        status: 'needs_review',
        canonicalMatch: {
          dishId: match.canonicalDish.id,
          dishName: match.canonicalDish.canonicalName,
          confidence: match.confidence,
          matchType: match.matchType,
        },
        proposedAsset: candidateAsset,
        isLocked: false,
      };
    }

    // No match
    return {
      id: generatedItemId,
      name: inputItem.name,
      category: inputItem.category || 'Mains',
      price: inputItem.price,
      description: inputItem.description || '',
      dietary: inputItem.dietary,
      status: 'no_image_match',
      isLocked: false,
    };
  });

  return {
    restaurantId,
    restaurantName,
    previewItems,
    proposedCategories: Array.from(categorySet),
  };
}

/**
 * Commit menu import transactionally:
 * - Persists all imported items and image assignments
 * - Applies any manual overrides from the preview screen
 * - Returns an audit summary report
 */
export function commitMenuImport(
  restaurantId: string,
  previewItems: ImportPreviewItem[],
  userOverrides: Record<string, string | null> = {},
  actor = 'restaurant_owner'
): { menu: RestaurantMenu; summary: ImportSummary } {
  const currentMenu = getRestaurantMenu(restaurantId);
  if (!currentMenu) {
    throw new Error(`Restaurant with ID "${restaurantId}" not found.`);
  }

  const now = new Date().toISOString();
  let automaticallyAssigned = 0;
  let preservedExisting = 0;
  let needsReview = 0;
  let noImageMatched = 0;

  const updatedItems: MenuItem[] = previewItems.map((preview) => {
    // Check if user manually changed or unassigned the image in the review modal
    const override = userOverrides[preview.id];
    let finalAssetId: string | undefined;
    let method: MenuItemAssignment['assignmentMethod'] = 'automatic_exact';
    let isLocked = preview.isLocked;
    let confidence = preview.canonicalMatch?.confidence || 1.0;

    if (override !== undefined) {
      // User explicitly intervened during review
      finalAssetId = override === null ? undefined : override;
      method = 'manual_owner';
      isLocked = true;
    } else if (preview.status === 'preserved_existing' || preview.status === 'manual_locked') {
      finalAssetId = preview.existingAssetId;
      method = preview.isLocked ? 'manual_owner' : 'retained_previous';
      preservedExisting++;
    } else if (preview.status === 'new_assignment' && preview.proposedAsset) {
      finalAssetId = preview.proposedAsset.id;
      method = preview.canonicalMatch?.matchType === 'alias' ? 'automatic_alias' : 'automatic_exact';
      automaticallyAssigned++;
    } else if (preview.status === 'needs_review') {
      // Leave unassigned until owner approves, or assign with review flag
      needsReview++;
    } else {
      noImageMatched++;
    }

    const assignment: MenuItemAssignment | undefined = finalAssetId
      ? {
          id: `asgn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          restaurantId,
          menuItemId: preview.id,
          imageAssetId: finalAssetId,
          assignmentMethod: method,
          matchConfidence: confidence,
          assignedAt: now,
          assignedBy: actor,
          isLocked,
          auditTrail: [
            {
              action: 'assigned',
              timestamp: now,
              actor,
              newAssetId: finalAssetId,
              reason: `Import commit (${preview.status})`,
            },
          ],
        }
      : undefined;

    return {
      id: preview.id,
      name: preview.name,
      category: preview.category,
      price: preview.price,
      description: preview.description,
      dietary: preview.dietary,
      isAvailable: true,
      imageAssignment: assignment,
    };
  });

  const updatedMenu: RestaurantMenu = {
    ...currentMenu,
    items: updatedItems,
    updatedAt: now,
  };

  saveRestaurantMenu(updatedMenu);

  const summary: ImportSummary = {
    totalProcessed: previewItems.length,
    automaticallyAssigned,
    preservedExisting,
    needsReview,
    noImageMatched,
    failedCount: 0,
    timestamp: now,
  };

  return {
    menu: getRestaurantMenu(restaurantId) || updatedMenu,
    summary,
  };
}
