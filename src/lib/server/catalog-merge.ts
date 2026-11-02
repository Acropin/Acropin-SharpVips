import type { ImageAsset } from '../images/types.js';

/** Merge legacy Blob metadata with Firestore metadata, preferring Firestore on ID collisions. */
export function mergeLegacyAndFirestoreImageAssets(
  legacyAssets: ImageAsset[],
  firestoreAssets: ImageAsset[]
): ImageAsset[] {
  const merged = new Map(legacyAssets.map((asset) => [asset.id, asset]));
  for (const asset of firestoreAssets) merged.set(asset.id, asset);
  return [...merged.values()];
}
