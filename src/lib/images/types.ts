/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AssetApprovalStatus = 'pending_review' | 'approved' | 'rejected' | 'revoked';

export type LicenseType = 
  | 'CC0'
  | 'CC-BY-4.0'
  | 'Unsplash-Commercial'
  | 'Pexels-Commercial'
  | 'Studio-Acropin-Proprietary'
  | 'Custom-Commercial';

export type DishDietary = 'veg' | 'non-veg' | 'vegan';

export interface FocalPoint {
  x: number; // 0.0 to 1.0 (0.5 is center)
  y: number; // 0.0 to 1.0 (0.5 is center)
}

export interface ImageProcessingOptions {
  width?: number; // default 480
  height?: number; // default 480
  format?: 'webp'; // default webp
  initialQuality?: number; // default 78
  effort?: number; // default 5
  targetSizeMinBytes?: number; // default 15 * 1024 (15KB)
  targetSizeMaxBytes?: number; // default 40 * 1024 (40KB)
  focalPoint?: FocalPoint;
}

export interface ProcessedImageResult {
  buffer: Buffer;
  hash: string; // SHA-256
  width: number;
  height: number;
  format: 'webp';
  byteSize: number;
  focalPoint: FocalPoint;
  qualityUsed: number;
  sizeDeviationWarning?: string;
  sourceDimensions: { width: number; height: number };
}

export interface ImageAsset {
  id: string; // unique asset ID
  canonicalDishId?: string;
  storageKey: string; // food-assets/{assetId}/v1/480.webp
  publicUrl: string; // stable public delivery URL
  sha256Hash: string;
  width: number; // 480
  height: number; // 480
  format: 'webp';
  byteSize: number;
  sourceUrl?: string;
  sourceProvider: string;
  licenseType: LicenseType;
  licenseEvidence: string; // URL, document ref or terms
  requiredAttribution?: string;
  processingVersion: string; // 'v1'
  processingQuality: number;
  focalPoint: FocalPoint;
  approvalStatus: AssetApprovalStatus;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  dishName: string;
  universalName: string; // clean universal slug, e.g. "margherita-pizza"
  filename: string; // default single name format, e.g. "margherita-pizza.webp"
  originalByteSize?: number;
}

export interface CanonicalDish {
  id: string;
  canonicalName: string;
  aliases: string[];
  cuisine: string;
  category: string;
  dietary: DishDietary;
  ingredients: string[];
  preparation?: string;
  suitableAssetIds: string[];
}

export type AssignmentMethod =
  | 'automatic_exact'
  | 'automatic_alias'
  | 'automatic_fuzzy'
  | 'manual_owner'
  | 'retained_previous';

export interface AuditEntry {
  action: 'assigned' | 'reassigned' | 'locked' | 'unassigned' | 'revoked_fallback';
  timestamp: string;
  actor: string;
  previousAssetId?: string;
  newAssetId?: string;
  reason?: string;
}

export interface MenuItemAssignment {
  id: string; // unique assignment ID
  restaurantId: string;
  menuItemId: string;
  imageAssetId?: string;
  assignmentMethod: AssignmentMethod;
  matchConfidence: number; // 0.0 to 1.0
  assignedAt: string;
  assignedBy: string;
  isLocked: boolean; // if true, automatic imports won't overwrite
  isRevokedFallback?: boolean;
  auditTrail: AuditEntry[];
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  dietary?: DishDietary;
  spicyLevel?: number;
  isAvailable: boolean;
  imageAssignment?: MenuItemAssignment;
  resolvedImageUrl?: string;
  attribution?: string;
}

export interface RestaurantMenu {
  id: string;
  restaurantId: string;
  restaurantName: string;
  tagline: string;
  cuisine: string;
  categories: string[];
  items: MenuItem[];
  updatedAt: string;
}

export interface MatchResult {
  matchType: 'exact' | 'alias' | 'fuzzy' | 'ambiguous' | 'none';
  confidence: number;
  canonicalDish?: CanonicalDish;
  suggestedAsset?: ImageAsset;
  requiresReview: boolean;
  reason: string;
}

export interface ImportPreviewItem {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  dietary?: DishDietary;
  status: 'new_assignment' | 'preserved_existing' | 'needs_review' | 'no_image_match' | 'manual_locked';
  canonicalMatch?: {
    dishId: string;
    dishName: string;
    confidence: number;
    matchType: string;
  };
  proposedAsset?: ImageAsset;
  existingAssetId?: string;
  isLocked: boolean;
}

export interface ImportSummary {
  totalProcessed: number;
  automaticallyAssigned: number;
  preservedExisting: number;
  needsReview: number;
  noImageMatched: number;
  failedCount: number;
  timestamp: string;
}
