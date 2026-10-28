/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CANONICAL_DISHES } from './canonical-dishes.js';
import type { CanonicalDish, DishDietary, MatchResult } from '../images/types.js';

// Keywords indicating non-vegetarian content
const NON_VEG_KEYWORDS = [
  'chicken', 'murgh', 'mutton', 'lamb', 'goat', 'beef', 'steak', 'pork',
  'bacon', 'ham', 'fish', 'prawn', 'shrimp', 'crab', 'lobster', 'egg',
  'pepperoni', 'guanciale', 'prosciutto', 'seafood', 'duck', 'chashu', 'meat'
];

// Keywords indicating vegetarian or vegan content
const VEG_KEYWORDS = [
  'veg', 'vegetarian', 'vegan', 'paneer', 'tofu', 'mushroom', 'dal',
  'lentil', 'subz', 'tarkari', 'plant-based', 'aloo', 'gobi', 'chana',
  'spinach', 'cheese', 'soya'
];

/**
 * Normalizes dish names by folding accents, stripping special characters,
 * collapsing whitespace, and converting to lowercase.
 */
export function normalizeDishName(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accent diacritics
    .toLowerCase()
    .replace(/['’`]/g, '') // strip apostrophes (e.g. "chef's" -> "chefs")
    .replace(/[^a-z0-9\s]/g, ' ') // replace other punctuation with space
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .trim();
}

/**
 * Detect dietary signals from text keywords.
 */
export function detectDietaryHint(text: string): DishDietary | null {
  const norm = normalizeDishName(text);
  const words = norm.split(' ');

  for (const word of words) {
    if (NON_VEG_KEYWORDS.includes(word)) {
      return 'non-veg';
    }
  }

  for (const word of words) {
    if (word === 'vegan') return 'vegan';
    if (VEG_KEYWORDS.includes(word)) return 'veg';
  }

  return null;
}

/**
 * Calculates Levenshtein distance similarity between two strings (0.0 to 1.0).
 */
export function stringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Token Jaccard overlap similarity (0.0 to 1.0).
 */
export function tokenOverlapSimilarity(s1: string, s2: string): number {
  const t1 = new Set(s1.split(' ').filter(Boolean));
  const t2 = new Set(s2.split(' ').filter(Boolean));

  if (t1.size === 0 || t2.size === 0) return 0.0;

  let intersection = 0;
  for (const token of t1) {
    if (t2.has(token)) intersection++;
  }

  const union = new Set([...t1, ...t2]).size;
  return intersection / union;
}

export interface MatchOptions {
  dietary?: DishDietary;
  category?: string;
  description?: string;
  highConfidenceThreshold?: number; // default 0.85
  reviewConfidenceThreshold?: number; // default 0.60
  customDishes?: CanonicalDish[];
}

/**
 * Match a restaurant menu item dish name against the canonical dish catalog.
 * Follows strict matching order:
 * 1. Exact canonical name match
 * 2. Approved alias match
 * 3. Menu metadata disambiguation
 * 4. Fuzzy token & Levenshtein matching
 * 5. Strict dietary safeguard enforcement
 */
export function matchCanonicalDish(
  rawDishName: string,
  options: MatchOptions = {}
): MatchResult {
  const normName = normalizeDishName(rawDishName);
  if (!normName) {
    return {
      matchType: 'none',
      confidence: 0,
      requiresReview: false,
      reason: 'Empty dish name provided.',
    };
  }

  const catalog = options.customDishes || CANONICAL_DISHES;
  const highThreshold = options.highConfidenceThreshold ?? 0.85;
  const reviewThreshold = options.reviewConfidenceThreshold ?? 0.60;

  // Determine item's dietary characteristic (from options or keyword scanning)
  const itemDietary = options.dietary || detectDietaryHint(normName + ' ' + (options.description || ''));

  // Helper to check dietary conflict
  const hasDietaryConflict = (dish: CanonicalDish): boolean => {
    if (!itemDietary) return false;
    // Non-veg vs Veg/Vegan is a strict blocker
    if (itemDietary === 'non-veg' && (dish.dietary === 'veg' || dish.dietary === 'vegan')) {
      return true;
    }
    if ((itemDietary === 'veg' || itemDietary === 'vegan') && dish.dietary === 'non-veg') {
      return true;
    }
    return false;
  };

  // Stage 1: Exact Canonical Name Match
  for (const dish of catalog) {
    const normCanonical = normalizeDishName(dish.canonicalName);
    if (normName === normCanonical) {
      if (hasDietaryConflict(dish)) {
        return {
          matchType: 'none',
          confidence: 0,
          requiresReview: true,
          reason: `Dietary mismatch blocked: "${rawDishName}" dietary profile conflicts with canonical "${dish.canonicalName}" (${dish.dietary}).`,
        };
      }

      return {
        matchType: 'exact',
        confidence: 1.0,
        canonicalDish: dish,
        requiresReview: false,
        reason: `Exact match found on canonical name: "${dish.canonicalName}".`,
      };
    }
  }

  // Stage 2: Approved Alias Match
  for (const dish of catalog) {
    for (const alias of dish.aliases) {
      const normAlias = normalizeDishName(alias);
      if (normName === normAlias) {
        if (hasDietaryConflict(dish)) {
          return {
            matchType: 'none',
            confidence: 0,
            requiresReview: true,
            reason: `Dietary mismatch blocked on alias "${alias}": conflicts with "${dish.canonicalName}" (${dish.dietary}).`,
          };
        }

        return {
          matchType: 'alias',
          confidence: 0.95,
          canonicalDish: dish,
          requiresReview: false,
          reason: `Exact match found on approved alias: "${alias}" for "${dish.canonicalName}".`,
        };
      }
    }
  }

  // Stage 3 & 4: Fuzzy and Contextual Matching
  let bestCandidate: CanonicalDish | null = null;
  let bestScore = 0;
  let matchOrigin = '';

  for (const dish of catalog) {
    if (hasDietaryConflict(dish)) {
      continue; // Never match conflicting dietary types
    }

    // Compare with canonical name
    const normCanonical = normalizeDishName(dish.canonicalName);
    const tokenSim = tokenOverlapSimilarity(normName, normCanonical);
    const stringSim = stringSimilarity(normName, normCanonical);
    let score = Math.max(tokenSim * 0.7 + stringSim * 0.3, stringSim);

    // Contextual boost: Category match
    if (options.category && dish.category.toLowerCase().includes(options.category.toLowerCase())) {
      score = Math.min(1.0, score + 0.05);
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = dish;
      matchOrigin = dish.canonicalName;
    }

    // Compare with all approved aliases as well
    for (const alias of dish.aliases) {
      const normAlias = normalizeDishName(alias);
      const aTokenSim = tokenOverlapSimilarity(normName, normAlias);
      const aStringSim = stringSimilarity(normName, normAlias);
      let aliasScore = Math.max(aTokenSim * 0.7 + aStringSim * 0.3, aStringSim);

      if (options.category && dish.category.toLowerCase().includes(options.category.toLowerCase())) {
        aliasScore = Math.min(1.0, aliasScore + 0.05);
      }

      if (aliasScore > bestScore) {
        bestScore = aliasScore;
        bestCandidate = dish;
        matchOrigin = `alias "${alias}"`;
      }
    }
  }

  // Threshold Evaluation
  if (bestCandidate && bestScore >= highThreshold) {
    return {
      matchType: 'fuzzy',
      confidence: Number(bestScore.toFixed(3)),
      canonicalDish: bestCandidate,
      requiresReview: false,
      reason: `High-confidence fuzzy match (${(bestScore * 100).toFixed(1)}%) against ${matchOrigin}.`,
    };
  }

  if (bestCandidate && bestScore >= reviewThreshold) {
    return {
      matchType: 'ambiguous',
      confidence: Number(bestScore.toFixed(3)),
      canonicalDish: bestCandidate,
      requiresReview: true,
      reason: `Ambiguous match candidate (${(bestScore * 100).toFixed(1)}%) against ${matchOrigin}. Requires owner verification.`,
    };
  }

  return {
    matchType: 'none',
    confidence: 0,
    requiresReview: false,
    reason: `No approved canonical dish matched above the ${(reviewThreshold * 100).toFixed(0)}% threshold. Item will use placeholder.`,
  };
}
