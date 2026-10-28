/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { matchCanonicalDish } from '../catalog/matcher.js';

// Stop-words to remove from universal filenames so they stay clean, short, and standard
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'with', 'and', 'or', 'in', 'of', 'for', 'on', 'at', 'to',
  'fresh', 'hot', 'crispy', 'best', 'delicious', 'tasty', 'homemade', 'style',
  'traditional', 'authentic', 'special', 'recipe', 'photo', 'image', 'picture',
  'high', 'res', '4k', 'hd', 'plate', 'dish', 'serving', 'bowl', 'closeup'
]);

/**
 * Converts any raw dish title, user input, or filename into a clean,
 * standardized universal food name and default filename (e.g. "margherita-pizza.webp").
 *
 * Examples:
 * - "Chef's Artisanal Pizza Margherita with Basil" -> "margherita-pizza" -> "margherita-pizza.webp"
 * - "Delicious Classic Double Cheeseburger 4k" -> "classic-cheeseburger" -> "classic-cheeseburger.webp"
 * - "Slow-Cooked Dal Makhani with Butter" -> "dal-makhani" -> "dal-makhani.webp"
 */
export function toUniversalFoodName(rawInput: string, fallbackSlug = 'food-dish'): {
  displayName: string;
  universalName: string;
  filename: string;
  matchedCanonicalName?: string;
} {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      displayName: 'Food Dish',
      universalName: fallbackSlug,
      filename: `${fallbackSlug}.webp`,
    };
  }

  // 1. Check if it matches an approved canonical dish in the catalog
  const match = matchCanonicalDish(rawInput);
  if (match.canonicalDish && match.confidence >= 0.70) {
    const canonical = match.canonicalDish.canonicalName;
    const universal = canonical
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return {
      displayName: canonical,
      universalName: universal,
      filename: `${universal}.webp`,
      matchedCanonicalName: canonical,
    };
  }

  // 2. Otherwise clean the input title down to an elegant universal slug
  const cleaned = rawInput
    .replace(/\.[^/.]+$/, '') // remove file extension if present
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .toLowerCase()
    .trim();

  // Filter stop-words if there are still multiple words left
  const tokens = cleaned.split(/[\s-_]+/).filter(Boolean);
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  const finalTokens = filtered.length > 0 ? filtered.slice(0, 3) : tokens.slice(0, 3);

  const universalName = (finalTokens.join('-') || fallbackSlug).toLowerCase();
  const displayName = finalTokens
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Food Dish';

  return {
    displayName,
    universalName,
    filename: `${universalName}.webp`,
  };
}
