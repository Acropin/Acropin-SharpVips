/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeCatalog } from '../server/catalog-store';
import { initializeRestaurants, getRestaurantMenu, updateMenuItemAssignment, saveRestaurantMenu } from '../server/restaurant-store';
import { generateImportPreview, commitMenuImport } from './menu-importer';

test('menu importer lifecycle: preview, auto-assign, preserve, and lock', async () => {
  // 1. Initialize stores
  await initializeCatalog();
  initializeRestaurants();

  const testTenant = `rest_test_${Date.now()}`;
  // Save an initial menu with just one item (Paneer Butter Masala)
  const initialTime = new Date().toISOString();
  saveRestaurantMenu({
    id: `menu_${testTenant}`,
    restaurantId: testTenant,
    restaurantName: 'Test Bistro',
    tagline: 'Test Bistro Tagline',
    cuisine: 'Indian',
    categories: ['Mains'],
    updatedAt: initialTime,
    items: [
      {
        id: 'item_test_1',
        name: 'Paneer Butter Masala',
        category: 'Mains',
        price: 15.0,
        description: 'Velvety cottage cheese',
        dietary: 'veg',
        isAvailable: true,
        imageAssignment: {
          id: 'asgn_test_1',
          restaurantId: testTenant,
          menuItemId: 'item_test_1',
          imageAssetId: 'asset_paneer_butter_masala_1',
          assignmentMethod: 'automatic_exact',
          matchConfidence: 1.0,
          assignedAt: initialTime,
          assignedBy: 'system',
          isLocked: false,
          auditTrail: [],
        },
      },
    ],
  });

  // 2. Generate preview for a new item payload
  const incomingJson = [
    {
      id: 'item_test_1', // existing item
      name: 'Paneer Butter Masala',
      category: 'Mains',
      price: 16.0, // price updated
      description: 'Updated description',
    },
    {
      name: 'Margherita Pizza', // new item for this restaurant that matches Italian catalog
      category: 'Fusion Specials',
      price: 18.0,
      description: 'Fresh basil and mozzarella',
    },
    {
      name: 'Unknown Dragon Stew', // completely unmatchable dish
      category: 'Exotics',
      price: 25.0,
    },
  ];

  const preview = generateImportPreview(testTenant, incomingJson);
  assert.equal(preview.previewItems.length, 3);

  // Item 1 should be preserved_existing
  const item1 = preview.previewItems.find((p) => p.name === 'Paneer Butter Masala');
  assert.ok(item1);
  assert.equal(item1?.status, 'preserved_existing');
  assert.equal(item1?.existingAssetId, 'asset_paneer_butter_masala_1');

  // Item 2 should be new_assignment (Margherita Pizza exists in approved catalog)
  const item2 = preview.previewItems.find((p) => p.name === 'Margherita Pizza');
  assert.ok(item2);
  assert.equal(item2?.status, 'new_assignment');
  assert.equal(item2?.proposedAsset?.id, 'asset_margherita_pizza_1');

  // Item 3 should be no_image_match
  const item3 = preview.previewItems.find((p) => p.name === 'Unknown Dragon Stew');
  assert.ok(item3);
  assert.equal(item3?.status, 'no_image_match');

  // 3. Commit import transaction
  const commitResult = commitMenuImport(testTenant, preview.previewItems);
  assert.equal(commitResult.summary.totalProcessed, 3);
  assert.equal(commitResult.summary.preservedExisting, 1);
  assert.equal(commitResult.summary.automaticallyAssigned, 1);
  assert.equal(commitResult.summary.noImageMatched, 1);

  // 4. Test Manual Lock Preservation:
  // Manually assign an image to Dragon Stew
  const updatedMenu = getRestaurantMenu(testTenant);
  const dragonItem = updatedMenu?.items.find((i) => i.name === 'Unknown Dragon Stew');
  assert.ok(dragonItem);

  updateMenuItemAssignment(testTenant, dragonItem!.id, 'asset_tiramisu_1', 'owner_marcus');

  // Re-run preview on same JSON
  const rePreview = generateImportPreview(testTenant, incomingJson);
  const lockedDragon = rePreview.previewItems.find((p) => p.name === 'Unknown Dragon Stew');
  assert.ok(lockedDragon);
  assert.equal(lockedDragon?.status, 'manual_locked');
  assert.equal(lockedDragon?.isLocked, true);
  assert.equal(lockedDragon?.existingAssetId, 'asset_tiramisu_1');
});
