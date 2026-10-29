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
  buffer: Buffer; // Primary 480x480
  hash: string; // SHA-256
  width: number; // 480
  height: number; // 480
  format: 'webp';
  byteSize: number;
  focalPoint: FocalPoint;
  qualityUsed: number;
  sizeDeviationWarning?: string;
  sourceDimensions: { width: number; height: number };
  // Compact 128x128 resolution thumbnail
  thumbnailBuffer: Buffer;
  thumbnailWidth: number; // 128
  thumbnailHeight: number; // 128
  thumbnailByteSize: number;
  thumbnailHash: string;
  // 960x960 Retina / Medium display
  retinaBuffer?: Buffer;
  retinaWidth?: number; // 960
  retinaHeight?: number; // 960
  retinaByteSize?: number;
  // 1600x1600 Full High-Res display
  hiResBuffer?: Buffer;
  hiResWidth?: number; // 1600
  hiResHeight?: number; // 1600
  hiResByteSize?: number;
}

export interface MlInspectionResult {
  isFood: boolean;
  matchesTargetDish: boolean;
  detectedDish: string;
  cuisine?: string;
  qualityScore: number; // 0 - 100
  antiCorruptionPassed: boolean;
  rejectionReason?: string;
  reasoning?: string;
  modelUsed: string;
  inspectedAt: string;
}

export interface AcropinMetadataTags {
  publisher: string;
  universalName: string;
  cleanExif: boolean;
  schemaVersion: string;
  variantsAvailable: string[];
  license: string;
  contributorGitHub?: string;
  dcoSignOff?: string;
  mlVerified: boolean;
  timestamp: string;
}

export interface ImageAsset {
  id: string; // unique asset ID
  canonicalDishId?: string;
  storageKey: string; // food-assets/{assetId}/480.webp
  publicUrl: string; // stable public delivery URL (480x480)
  thumbnailStorageKey?: string; // food-assets/{assetId}/128.webp
  thumbnailUrl?: string; // stable public thumbnail URL (128x128)
  thumbnailByteSize?: number;
  retinaStorageKey?: string; // food-assets/{assetId}/960.webp
  retinaUrl?: string; // stable public retina URL (960x960)
  retinaByteSize?: number;
  hiResStorageKey?: string; // food-assets/{assetId}/1600.webp
  hiResUrl?: string; // stable public full-res URL (1600x1600)
  hiResByteSize?: number;
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
  // Contributor DCO & GitHub Info
  contributorGitHub?: string;
  contributorDcoEmail?: string;
  dcoSignOff?: string;
  // Real-time ML Anti-Corruption Verification
  mlInspection?: MlInspectionResult;
  // Acropin Universal Metadata Tag System
  acropinMetadata?: AcropinMetadataTags;
}

export interface DatasetTargetItem {
  id: string;
  name: string;
  universalSlug: string;
  region: string; // e.g. 'North Indian', 'South Indian', 'Pan-Indian', 'Italian', 'Global'
  category: string;
  dietary: DishDietary;
  ingredients?: string[];
  notes?: string;
  createdAt: string;
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
