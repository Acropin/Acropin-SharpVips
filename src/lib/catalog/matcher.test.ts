/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCanonicalDish, normalizeDishName, detectDietaryHint } from './matcher';

test('normalizeDishName cleans whitespace, accents, and casing', () => {
  assert.equal(normalizeDishName('  Crème   Brûlée! '), 'creme brulee');
  assert.equal(normalizeDishName("Chef's Special: Pizza Margherita"), 'chefs special pizza margherita');
  assert.equal(normalizeDishName('Paneer-Butter_Masala'), 'paneer butter masala');
});

test('detectDietaryHint detects dietary characteristics accurately', () => {
  assert.equal(detectDietaryHint('Crispy Chicken Wings with Ranch'), 'non-veg');
  assert.equal(detectDietaryHint('Spicy Tofu & Mushroom Stir Fry'), 'veg');
  assert.equal(detectDietaryHint('Vegan Avocado Salad'), 'vegan');
  assert.equal(detectDietaryHint('Plain Mineral Water'), null);
});

test('matchCanonicalDish finds exact canonical match', () => {
  const result = matchCanonicalDish('Margherita Pizza');
  assert.equal(result.matchType, 'exact');
  assert.equal(result.confidence, 1.0);
  assert.equal(result.canonicalDish?.id, 'dish_margherita_pizza');
  assert.equal(result.requiresReview, false);
});

test('matchCanonicalDish finds approved alias match', () => {
  // "Paneer Makhani" is an approved alias for "Paneer Butter Masala"
  const result = matchCanonicalDish('Paneer Makhani');
  assert.equal(result.matchType, 'alias');
  assert.ok(result.confidence >= 0.9);
  assert.equal(result.canonicalDish?.id, 'dish_paneer_butter_masala');
  assert.equal(result.requiresReview, false);
});

test('matchCanonicalDish blocks vegetarian to non-vegetarian mismatches', () => {
  // "Chicken Biryani" should NEVER match "Vegetable Biryani"
  const chickenResult = matchCanonicalDish('Hyderabadi Chicken Biryani', {
    dietary: 'non-veg',
  });
  assert.equal(chickenResult.canonicalDish?.id, 'dish_chicken_biryani');
  assert.equal(chickenResult.canonicalDish?.dietary, 'non-veg');

  // If someone enters "Chicken Paneer Masala" (contradictory) with non-veg dietary,
  // it must NOT match the vegetarian "Paneer Butter Masala"
  const blockedResult = matchCanonicalDish('Chicken Paneer Masala', {
    dietary: 'non-veg',
  });
  if (blockedResult.canonicalDish) {
    assert.notEqual(blockedResult.canonicalDish.dietary, 'veg');
  }
});

test('matchCanonicalDish returns ambiguous match when confidence is moderate', () => {
  // A dish with some resemblance but variations
  const result = matchCanonicalDish('Artisanal Stonebaked Napoli Crust Pizza');
  // It should either be ambiguous or none, never a false 1.0 match
  assert.ok(result.confidence < 0.95);
});

test('matchCanonicalDish returns none for completely unknown dish', () => {
  const result = matchCanonicalDish('Xylophone Astronaut Stew 99');
  assert.equal(result.matchType, 'none');
  assert.equal(result.confidence, 0);
  assert.equal(result.canonicalDish, undefined);
});
