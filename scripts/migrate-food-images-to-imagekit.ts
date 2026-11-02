/**
 * Copy legacy food image files to private ImageKit storage and update their
 * corresponding Firestore metadata. The legacy source files are never deleted.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getAppDataFile } from '../src/lib/storage/data-directory.js';
import { isBlobStorageConfigured, readPersistentJson } from '../src/lib/storage/persistent-json.js';
import {
  isFirestoreConfigured,
  isFirestoreImageCatalogMigrated,
  markFirestoreImageCatalogMigrated,
  readFirestoreImageAssets,
  writeFirestoreImageAssetChanges,
} from '../src/lib/storage/firestore.js';
import { ImageKitStorageProvider, isImageKitConfigured } from '../src/lib/storage/imagekit-storage.js';
import type { ImageAsset } from '../src/lib/images/types.js';
import { mergeLegacyAndFirestoreImageAssets } from '../src/lib/server/catalog-merge.js';

function extensionFor(contentType: string): string {
  switch (contentType.toLowerCase().split(';')[0].trim()) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/avif': return 'avif';
    case 'image/tiff': return 'tiff';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    default: throw new Error(`Unsupported stored image type: ${contentType}`);
  }
}

function isImageAsset(value: unknown): value is ImageAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const asset = value as Partial<ImageAsset>;
  return typeof asset.id === 'string' && typeof asset.storageKey === 'string' &&
    typeof asset.dishName === 'string' && typeof asset.universalName === 'string' &&
    typeof asset.approvalStatus === 'string';
}

const apply = process.argv.includes('--apply');
if (!isFirestoreConfigured()) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON before running the migration.');
if (!isImageKitConfigured()) throw new Error('Set all ImageKit server environment variables before running the migration.');
if (!isBlobStorageConfigured()) throw new Error('Connect the legacy Vercel Blob store with OIDC or configure BLOB_READ_WRITE_TOKEN before migrating.');

const [firestoreAssets, legacyValue, alreadyMigrated] = await Promise.all([
  readFirestoreImageAssets(),
  readPersistentJson<unknown>('app-data/catalog.json', getAppDataFile('catalog.json')),
  isFirestoreImageCatalogMigrated(),
]);
if (legacyValue !== null && (!Array.isArray(legacyValue) || !legacyValue.every(isImageAsset))) {
  throw new Error('Legacy food image catalog is invalid. No files were changed.');
}
const legacyAssets = (legacyValue ?? []) as ImageAsset[];
const assets = mergeLegacyAndFirestoreImageAssets(
  legacyAssets.filter((asset) => !asset.tags?.includes('npm-package')),
  firestoreAssets ?? []
).filter((asset) =>
  !asset.tags?.includes('npm-package') && !asset.storageProviderId
);
const firestoreIds = new Set((firestoreAssets ?? []).map((asset) => asset.id));
const legacyMetadataToSeed = legacyAssets.filter((asset) =>
  !asset.tags?.includes('npm-package') && !firestoreIds.has(asset.id)
);

console.log(`${apply ? 'Applying' : 'Dry run:'} ${assets.length} legacy food image file(s) to migrate.`);
if (!apply) {
  for (const asset of assets) console.log(`  ${asset.id}  ${asset.dishName}  ${asset.storageKey}`);
  console.log(`No data was changed. Run with -- --apply to seed ${legacyMetadataToSeed.length} missing catalog record(s) and copy files to ImageKit.`);
  process.exit(0);
}

if (legacyMetadataToSeed.length) {
  await writeFirestoreImageAssetChanges(legacyMetadataToSeed, []);
  console.log(`Copied ${legacyMetadataToSeed.length} existing food image record(s) to Firestore; the Blob catalog remains intact.`);
}
if (!alreadyMigrated) await markFirestoreImageCatalogMigrated();

const { getStorageProvider } = await import('../src/lib/storage/image-storage.js');
const legacyStorage = getStorageProvider();
const imageKitStorage = new ImageKitStorageProvider();
let migrated = 0;
const skipped: string[] = [];
for (const asset of assets) {
  const source = await legacyStorage.get(asset.storageKey);
  if (!source || !source.data.length) {
    skipped.push(`${asset.id} (${asset.storageKey})`);
    console.error(`Skipped ${asset.id}: legacy source file is missing (${asset.storageKey}).`);
    continue;
  }
  const safeId = asset.id.replace(/[^a-zA-Z0-9_-]/gu, '_');
  const destination = `food-assets-migrated/${safeId}/${randomUUID()}/source.${extensionFor(source.contentType)}`;
  const uploaded = await imageKitStorage.upload(destination, source.data, source.contentType);
  const updated = {
    ...asset,
    storageKey: uploaded.key,
    storageProviderId: uploaded.providerId,
    updatedAt: new Date().toISOString(),
  };
  await writeFirestoreImageAssetChanges([updated], []);
  migrated += 1;
  console.log(`Migrated ${asset.dishName} (${migrated}/${assets.length}). Original Blob file retained.`);
}

if (skipped.length) {
  throw new Error(`Image migration is incomplete: ${migrated}/${assets.length} copied. Keep Blob connected and resolve these missing files before considering the migration complete: ${skipped.join(', ')}`);
}
console.log(`Migration finished: ${migrated}/${assets.length} copied. Verify the production library before changing or removing any legacy storage.`);
