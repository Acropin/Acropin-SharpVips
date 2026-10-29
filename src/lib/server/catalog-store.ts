/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { foodImages } from 'acropin-food-images';
import { getAppDataFile } from '../storage/data-directory.js';
import { getStorageProvider } from '../storage/image-storage.js';
import { readPersistentJson, writePersistentJson } from '../storage/persistent-json.js';
import {
  computePerceptualHash,
  MAX_PERCEPTUAL_DUPLICATE_DISTANCE,
  perceptualHashDistance,
} from '../images/perceptual-hash.js';
import { fetchRemoteImage } from './remote-image.js';
import type { AssetApprovalStatus, ImageAsset } from '../images/types.js';

const catalogDataFile = () => getAppDataFile('catalog.json');
const DISALLOWED_IMAGE_HOSTS = [
  'unsplash.com',
  'pexels.com',
  'shutterstock.com',
  'gettyimages.com',
  'istockphoto.com',
  'adobe.com',
  'freepik.com',
];
const LEGACY_INDEX_BATCH_SIZE = 12;
const MAX_PACKAGED_ASSET_BYTES = 2 * 1024 * 1024;

let assetCatalog: ImageAsset[] = [];
let isInitialized = false;
let initializePromise: Promise<void> | null = null;
let pendingSave: Promise<void> = Promise.resolve();

export class DuplicateAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateAssetError';
  }
}

export class PerceptualIndexUnavailableError extends Error {
  constructor() {
    super('Could not verify image similarity against the full catalog. The upload was not accepted; retry after the catalog image index is available.');
    this.name = 'PerceptualIndexUnavailableError';
  }
}

function isPerceptualHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{16}$/iu.test(value);
}

function getPackageAssets(): ImageAsset[] {
  const loadedAt = new Date().toISOString();
  return foodImages.map((image) => ({
    id: image.id,
    canonicalDishId: image.canonicalDishId,
    storageKey: `npm-package/${image.slug}`,
    publicUrl: image.url,
    sha256Hash: image.sha256,
    perceptualHash: image.perceptualHash,
    width: image.width,
    height: image.height,
    format: 'webp',
    byteSize: image.byteSize,
    sourceUrl: image.sourceUrl,
    sourceProvider: new URL(image.sourceUrl).hostname,
    licenseType: image.license === 'CC0-1.0' ? 'CC0' : 'CC-BY-4.0',
    licenseEvidence: image.licenseEvidenceUrl,
    requiredAttribution: image.attribution,
    processingVersion: 'v1',
    processingQuality: 78,
    focalPoint: { ...image.focalPoint },
    approvalStatus: 'approved',
    createdAt: loadedAt,
    updatedAt: loadedAt,
    tags: [...image.tags, 'npm-package'],
    dishName: image.dishName,
    universalName: image.slug,
    filename: `${image.slug}.webp`,
    originalByteSize: image.originalByteSize,
  }));
}

function saveCatalogToFile() {
  const snapshot = assetCatalog.filter((asset) => !asset.tags?.includes('npm-package'));
  pendingSave = pendingSave.catch(() => undefined).then(() =>
    writePersistentJson('app-data/catalog.json', catalogDataFile(), snapshot)
  );
}

function isLegacyPlaceholderAsset(asset: ImageAsset): boolean {
  const tags = asset.tags ?? [];
  let sourceHost = '';
  if (asset.sourceUrl) {
    try {
      sourceHost = new URL(asset.sourceUrl).hostname.toLowerCase();
    } catch {
      return true;
    }
  }
  const evidence = asset.licenseEvidence?.trim().toLowerCase() ?? '';
  const hasContributorAttestation = evidence.startsWith('contributor attestation:');
  const invalidHash = !/^[a-f0-9]{64}$/iu.test(asset.sha256Hash);
  let evidenceHost = '';
  if (!hasContributorAttestation) {
    try {
      const evidenceUrl = new URL(asset.licenseEvidence);
      if (evidenceUrl.protocol !== 'https:') return true;
      evidenceHost = evidenceUrl.hostname.toLowerCase();
    } catch {
      return true;
    }
  }

  return (
    tags.some((tag) => ['seed-catalog', 'fixture', 'npm-package'].includes(tag)) ||
    asset.sourceProvider.trim().toLowerCase() === 'test provider' ||
    invalidHash ||
    (asset.licenseType !== 'CC0' && asset.licenseType !== 'CC-BY-4.0') ||
    asset.rightsAttested !== true ||
    !asset.rightsAttestedAt ||
    !Number.isFinite(Date.parse(asset.rightsAttestedAt)) ||
    (!hasContributorAttestation && (
      evidenceHost === 'example.com' || evidenceHost.endsWith('.example.com') ||
      evidenceHost === 'example.org' || evidenceHost.endsWith('.example.org') ||
      evidenceHost === 'example' || evidenceHost.endsWith('.example') ||
      evidenceHost === 'test' || evidenceHost.endsWith('.test') ||
      evidenceHost === 'invalid' || evidenceHost.endsWith('.invalid') ||
      evidenceHost === 'localhost' ||
      evidenceHost.endsWith('.localhost') || evidenceHost.endsWith('.local')
    )) ||
    ['direct upload', 'clipboard', 'test evidence'].includes(evidence) ||
    (sourceHost !== '' && DISALLOWED_IMAGE_HOSTS.some((host) => sourceHost === host || sourceHost.endsWith(`.${host}`))) ||
    (asset.sourceUrl !== undefined && evidence === asset.sourceUrl.trim().toLowerCase())
  );
}

function isImageAsset(value: unknown): value is ImageAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const asset = value as Partial<ImageAsset>;
  return (
    typeof asset.id === 'string' &&
    typeof asset.sha256Hash === 'string' &&
    (asset.perceptualHash === undefined || isPerceptualHash(asset.perceptualHash)) &&
    typeof asset.sourceProvider === 'string' &&
    typeof asset.licenseEvidence === 'string' &&
    typeof asset.dishName === 'string' &&
    typeof asset.universalName === 'string'
  );
}

function removeUnverifiedLegacyAttribution(asset: ImageAsset): ImageAsset {
  const clean = { ...asset } as ImageAsset & {
    contributorDcoEmail?: string;
    dcoSignOff?: string;
  };
  delete clean.contributorDcoEmail;
  delete clean.dcoSignOff;
  if (clean.contributorGitHub === 'acropin-contributor') delete clean.contributorGitHub;

  if (clean.mlInspection && !clean.mlInspection.verificationLevel) {
    clean.mlInspection = {
      ...clean.mlInspection,
      verificationLevel: 'structural-check',
      isFood: null,
      matchesTargetDish: null,
      detectedDish: 'Not evaluated without a vision model',
      qualityScore: undefined,
      reasoning: 'Legacy inspection data cannot confirm food identity or image quality; human review is required.',
    };
  }

  if (clean.acropinMetadata) {
    const metadata = { ...clean.acropinMetadata } as typeof clean.acropinMetadata & {
      dcoSignOff?: string;
    };
    delete metadata.dcoSignOff;
    if (metadata.contributorGitHub === 'acropin-contributor') delete metadata.contributorGitHub;
    metadata.mlVerified = Boolean(
      clean.mlInspection?.verificationLevel === 'vision-model' && clean.mlInspection.antiCorruptionPassed
    );
    clean.acropinMetadata = metadata;
  }
  return clean;
}

function hasUnverifiedLegacyAttribution(asset: ImageAsset): boolean {
  const legacy = asset as ImageAsset & { contributorDcoEmail?: string; dcoSignOff?: string };
  return Boolean(
    legacy.contributorDcoEmail ||
    legacy.dcoSignOff ||
    (asset.mlInspection && !asset.mlInspection.verificationLevel) ||
    (asset.acropinMetadata && asset.acropinMetadata.mlVerified !== Boolean(
      asset.mlInspection?.verificationLevel === 'vision-model' && asset.mlInspection.antiCorruptionPassed
    )) ||
    asset.contributorGitHub === 'acropin-contributor' ||
    (asset.acropinMetadata as (ImageAsset['acropinMetadata'] & { dcoSignOff?: string }) | undefined)?.dcoSignOff ||
    asset.acropinMetadata?.contributorGitHub === 'acropin-contributor'
  );
}

/**
 * Initialize catalog store.
 * Real production data only - no synthetic or toy mock assets.
 */
export async function initializeCatalog(): Promise<void> {
  if (isInitialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      try {
        const parsed = await readPersistentJson<unknown>('app-data/catalog.json', catalogDataFile());
        if (parsed !== null && (!Array.isArray(parsed) || !parsed.every(isImageAsset))) {
          throw new Error('Image catalog storage is invalid. Fix the stored data before accepting uploads.');
        }

        const packageAssets = getPackageAssets();
        const packageSlugs = new Set(packageAssets.map((asset) => asset.universalName));
        const savedAssets = (parsed ?? []) as ImageAsset[];
        const acceptedAssets = savedAssets.filter((asset) => !isLegacyPlaceholderAsset(asset));
        const storedAssets = acceptedAssets.map(removeUnverifiedLegacyAttribution);
        // A reviewed npm contribution takes precedence over an older app-managed
        // image with the same universal dish name.
        assetCatalog = [
          ...storedAssets.filter((asset) => !packageSlugs.has(asset.universalName)),
          ...packageAssets,
        ];

        const attributionChanged = acceptedAssets.some(hasUnverifiedLegacyAttribution);
        const placeholdersRemoved = storedAssets.length !== savedAssets.length;
        if ((placeholdersRemoved || attributionChanged) &&
            (process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL !== '1')) {
          saveCatalogToFile();
          await flushCatalog();
        }
      } catch (error) {
        initializePromise = null;
        throw error;
      }
      isInitialized = true;
    })();
  }
  await initializePromise;
}

/** Reload durable catalog state before contribution decisions made by warm instances. */
export async function refreshCatalogFromStorage(): Promise<void> {
  await initializeCatalog();
  const parsed = await readPersistentJson<unknown>('app-data/catalog.json', catalogDataFile());
  if (parsed !== null && (!Array.isArray(parsed) || !parsed.every(isImageAsset))) {
    throw new Error('Image catalog storage is invalid. Fix the stored data before accepting uploads.');
  }

  const packageAssets = getPackageAssets();
  const packageSlugs = new Set(packageAssets.map((asset) => asset.universalName));
  const savedAssets = (parsed ?? []) as ImageAsset[];
  const storedAssets = savedAssets
    .filter((asset) => !isLegacyPlaceholderAsset(asset))
    .map(removeUnverifiedLegacyAttribution);
  assetCatalog = [
    ...storedAssets.filter((asset) => !packageSlugs.has(asset.universalName)),
    ...packageAssets,
  ];
}

export async function flushCatalog(): Promise<void> {
  await pendingSave;
}

export function getAllAssets(filter?: {
  status?: AssetApprovalStatus;
  search?: string;
  dishId?: string;
}): ImageAsset[] {
  initializeCatalog();
  let list = assetCatalog;

  if (filter?.status) {
    list = list.filter((a) => a.approvalStatus === filter.status);
  }

  if (filter?.dishId) {
    list = list.filter((a) => a.canonicalDishId === filter.dishId);
  }

  if (filter?.search) {
    const q = filter.search.toLowerCase().trim();
    list = list.filter(
      (a) =>
        a.dishName.toLowerCase().includes(q) ||
        a.universalName?.toLowerCase().includes(q) ||
        a.filename?.toLowerCase().includes(q) ||
        a.tags?.some((t) => t.toLowerCase().includes(q)) ||
        (a.requiredAttribution && a.requiredAttribution.toLowerCase().includes(q))
    );
  }

  return list;
}

export function getAssetById(id: string): ImageAsset | undefined {
  initializeCatalog();
  return assetCatalog.find((a) => a.id === id || a.universalName === id);
}

export function findAssetByHash(hash: string): ImageAsset | undefined {
  initializeCatalog();
  return assetCatalog.find((a) => a.sha256Hash === hash);
}

/**
 * Find a visually near-identical image. Older saved records are indexed from
 * their stored 480px asset once, then persisted so later checks are in-memory.
 */
export async function findSimilarAssetByPerceptualHash(
  perceptualHash: string
): Promise<{ asset: ImageAsset; distance: number } | undefined> {
  if (!isPerceptualHash(perceptualHash)) {
    throw new Error('Invalid perceptual image hash.');
  }

  await initializeCatalog();
  const missingHashes = assetCatalog.filter((asset) => !isPerceptualHash(asset.perceptualHash));
  let indexedLegacyAssets = false;
  const storage = getStorageProvider();

  for (let start = 0; start < missingHashes.length; start += LEGACY_INDEX_BATCH_SIZE) {
    const batch = missingHashes.slice(start, start + LEGACY_INDEX_BATCH_SIZE);
    await Promise.all(batch.map(async (asset) => {
      let imageBuffer: Buffer | undefined;
      try {
        const stored = await storage.get(asset.storageKey);
        imageBuffer = stored?.data;
        if (!imageBuffer && asset.tags?.includes('npm-package')) {
          imageBuffer = await fetchRemoteImage(asset.publicUrl, MAX_PACKAGED_ASSET_BYTES);
        }
        if (!imageBuffer) throw new Error('Stored image bytes are unavailable.');
        asset.perceptualHash = await computePerceptualHash(imageBuffer);
        indexedLegacyAssets = true;
      } catch {
        throw new PerceptualIndexUnavailableError();
      }
    }));
  }

  if (indexedLegacyAssets) {
    saveCatalogToFile();
    await flushCatalog();
  }

  let closestMatch: { asset: ImageAsset; distance: number } | undefined;
  for (const asset of assetCatalog) {
    if (!asset.perceptualHash) continue;
    const distance = perceptualHashDistance(perceptualHash, asset.perceptualHash);
    if (distance <= MAX_PERCEPTUAL_DUPLICATE_DISTANCE && (!closestMatch || distance < closestMatch.distance)) {
      closestMatch = { asset, distance };
    }
  }
  return closestMatch;
}

/** A pending, approved, or revoked name stays locked against repeat uploads. */
export function findBlockingAssetBySlug(slug: string): ImageAsset | undefined {
  initializeCatalog();
  return assetCatalog.find((asset) => asset.universalName === slug &&
    ['pending_review', 'approved', 'revoked'].includes(asset.approvalStatus));
}

export async function registerAsset(asset: ImageAsset): Promise<ImageAsset> {
  initializeCatalog();
  if (assetCatalog.some((existing) => existing.id === asset.id || existing.sha256Hash === asset.sha256Hash)) {
    throw new DuplicateAssetError('An asset with this ID or image hash already exists.');
  }
  if (isPerceptualHash(asset.perceptualHash)) {
    const similarAsset = assetCatalog.find((existing) =>
      isPerceptualHash(existing.perceptualHash) &&
      perceptualHashDistance(asset.perceptualHash as string, existing.perceptualHash) <= MAX_PERCEPTUAL_DUPLICATE_DISTANCE
    );
    if (similarAsset) {
      throw new DuplicateAssetError(
        `This image is a near-duplicate of “${similarAsset.dishName}” in the library.`
      );
    }
  }
  if (findBlockingAssetBySlug(asset.universalName)) {
    throw new DuplicateAssetError(
      'A contribution for this dish is already pending review or published. Duplicate dish submissions are locked.'
    );
  }

  assetCatalog.unshift(asset);
  saveCatalogToFile();
  try {
    await flushCatalog();
  } catch (error) {
    assetCatalog = assetCatalog.filter((existing) => existing.id !== asset.id);
    saveCatalogToFile();
    try {
      await flushCatalog();
    } catch (rollbackError) {
      console.error('Could not persist catalog rollback after a failed asset write:', rollbackError);
    }
    throw error;
  }
  return asset;
}

export async function deleteAsset(id: string): Promise<boolean> {
  initializeCatalog();
  const index = assetCatalog.findIndex((a) => a.id === id);
  if (index === -1) return false;
  if (assetCatalog[index].tags?.includes('npm-package')) return false;

  const [removed] = assetCatalog.splice(index, 1);
  saveCatalogToFile();
  await flushCatalog();

  const storageKeys = [
    removed?.storageKey,
    removed?.thumbnailStorageKey,
    removed?.retinaStorageKey,
    removed?.hiResStorageKey,
  ].filter((key): key is string => Boolean(key));
  const storage = getStorageProvider();
  const deletionResults = await Promise.allSettled(storageKeys.map((key) => storage.delete(key)));
  const failedDeletes = deletionResults
    .map((result, index) => ({ result, key: storageKeys[index] }))
    .filter((entry) => entry.result.status === 'rejected');
  if (failedDeletes.length > 0) {
    console.error('Some image variants could not be removed from storage:', failedDeletes.map(({ key }) => key));
  }

  return true;
}

export function isPackageAsset(id: string): boolean {
  initializeCatalog();
  return assetCatalog.some((asset) => asset.id === id && asset.tags?.includes('npm-package'));
}

export function updateAssetStatus(
  assetId: string,
  newStatus: AssetApprovalStatus,
  reason?: string
): ImageAsset | undefined {
  initializeCatalog();
  const asset = assetCatalog.find((a) => a.id === assetId);
  if (!asset || asset.tags?.includes('npm-package')) return undefined;

  asset.approvalStatus = newStatus;
  asset.updatedAt = new Date().toISOString();
  if (reason) {
    asset.rejectionReason = reason;
  }

  saveCatalogToFile();
  return asset;
}
