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
export type DatasetTargetDietary = DishDietary | 'egg' | 'mixed' | 'unknown';

export interface FocalPoint {
  x: number; // 0.0 to 1.0 (0.5 is center)
  y: number; // 0.0 to 1.0 (0.5 is center)
}

export interface ImageProcessingOptions {
  width?: number; // maximum edge for the primary variant; default 480
  height?: number; // maximum edge for the primary variant; default 480
  format?: 'webp'; // default webp
  initialQuality?: number; // default 95; output is never degraded to meet a byte target
  effort?: number; // default 6
  /** Skip prebuilding variants when the caller stores the source and serves sizes on demand. */
  generateHierarchy?: boolean;
  /** @deprecated Retained for old clients; full-frame output does not crop by focal point. */
  focalPoint?: FocalPoint;
}

export interface ProcessedImageResult {
  buffer: Buffer; // Primary variant, at most 480px on its longest edge
  hash: string; // SHA-256
  perceptualHash: string; // 64-bit DCT hash for near-duplicate detection
  width: number; // Actual dimensions after aspect-preserving resize
  height: number;
  format: 'webp';
  sourceFormat: string;
  byteSize: number;
  /** @deprecated Kept for metadata compatibility; no crop is applied. */
  focalPoint: FocalPoint;
  qualityUsed: number;
  sizeDeviationWarning?: string;
  sourceDimensions: { width: number; height: number };
  // Compact thumbnail with a maximum edge of 128px
  thumbnailBuffer: Buffer;
  thumbnailWidth: number; // Actual dimensions, with longest edge at most 128px
  thumbnailHeight: number;
  thumbnailByteSize: number;
  thumbnailHash: string;
  // High-density variant (maximum edge 960px)
  retinaBuffer?: Buffer;
  retinaWidth?: number; // Actual dimensions, with longest edge at most 960px
  retinaHeight?: number;
  retinaByteSize?: number;
  // High-resolution variant (maximum edge 1600px)
  hiResBuffer?: Buffer;
  hiResWidth?: number; // Actual dimensions, with longest edge at most 1600px
  hiResHeight?: number;
  hiResByteSize?: number;
}

export type ProcessedImageOnDemandResult = Omit<
  ProcessedImageResult,
  'thumbnailBuffer' | 'thumbnailWidth' | 'thumbnailHeight' | 'thumbnailByteSize' | 'thumbnailHash' |
  'retinaBuffer' | 'retinaWidth' | 'retinaHeight' | 'retinaByteSize' |
  'hiResBuffer' | 'hiResWidth' | 'hiResHeight' | 'hiResByteSize'
> & {
  thumbnailBuffer?: Buffer;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailByteSize?: number;
  thumbnailHash?: string;
  retinaBuffer?: Buffer;
  retinaWidth?: number;
  retinaHeight?: number;
  retinaByteSize?: number;
  hiResBuffer?: Buffer;
  hiResWidth?: number;
  hiResHeight?: number;
  hiResByteSize?: number;
};

export interface MlInspectionResult {
  verificationLevel: 'vision-model' | 'structural-check';
  isFood: boolean | null;
  matchesTargetDish: boolean | null;
  detectedDish: string;
  cuisine?: string;
  qualityScore?: number; // 0 - 100; only provided by a vision model
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
  rightsAttested?: boolean;
  mlVerified: boolean;
  timestamp: string;
}

export interface ImageAsset {
  id: string; // unique asset ID
  canonicalDishId?: string;
  storageKey: string; // Legacy assets point to a stored variant; v3 assets point to their single private source.
  publicUrl: string; // Stable on-demand delivery URL (480px maximum edge for new assets).
  /** Source is stored once; transformed variants are delivered on request. */
  sourceFormat?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  thumbnailStorageKey?: string; // food-assets/{assetId}/128.webp
  thumbnailUrl?: string; // stable public thumbnail URL (maximum edge 128px)
  thumbnailByteSize?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  retinaStorageKey?: string; // food-assets/{assetId}/960.webp
  retinaUrl?: string; // stable public retina URL (maximum edge 960px)
  retinaByteSize?: number;
  retinaWidth?: number;
  retinaHeight?: number;
  hiResStorageKey?: string; // food-assets/{assetId}/1600.webp
  hiResUrl?: string; // stable public full-res URL (maximum edge 1600px)
  hiResByteSize?: number;
  hiResWidth?: number;
  hiResHeight?: number;
  sha256Hash: string;
  perceptualHash?: string; // Optional for older catalog records awaiting index migration
  width: number; // Actual primary variant width
  height: number; // Actual primary variant height
  format: 'webp';
  byteSize: number;
  sourceUrl?: string;
  sourceProvider: string;
  licenseType: LicenseType;
  licenseEvidence: string; // URL, document ref or terms
  requiredAttribution?: string;
  rightsAttested?: boolean;
  rightsAttestedAt?: string;
  processingVersion: string; // 'v1' for legacy assets, 'v3-on-demand' for single-source delivery
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
  contributorId?: string;
  // Real-time ML Anti-Corruption Verification
  mlInspection?: MlInspectionResult;
  // Acropin Universal Metadata Tag System
  acropinMetadata?: AcropinMetadataTags;
}

export interface DatasetTargetItem {
  id: string;
  name: string;
  universalSlug: string;
  region?: string; // Only set when the contributor provides a region.
  category: string;
  dietary: DatasetTargetDietary;
  sourceIds?: string[];
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
