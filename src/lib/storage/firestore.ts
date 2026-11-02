/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { timingSafeEqual } from 'node:crypto';
import { cert, getApps, initializeApp, type ServiceAccount as FirebaseServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { ImageAsset } from '../images/types.js';

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function serviceAccount(): ServiceAccount | null {
  if (process.env.NODE_ENV === 'test') return null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ServiceAccount;
    if (!value.project_id || !value.client_email || !value.private_key) return null;
    return { ...value, private_key: value.private_key.replaceAll('\\n', '\n') };
  } catch {
    return null;
  }
}

export function isFirestoreConfigured(): boolean {
  return serviceAccount() !== null;
}

export function firestoreDb() {
  const account = serviceAccount();
  if (!account) throw new Error('Firestore is not configured. Add FIREBASE_SERVICE_ACCOUNT_JSON to the server environment.');
  const app = getApps().find((candidate) => candidate.name === 'acropin-food-library') ?? initializeApp({
    credential: cert({
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    } as FirebaseServiceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || account.project_id,
  }, 'acropin-food-library');
  return getFirestore(app);
}

const ASSET_COLLECTION = 'foodImageAssets';
const MIGRATION_COLLECTION = 'foodImageMigrations';

export async function isFirestoreImageCatalogMigrated(): Promise<boolean> {
  if (!isFirestoreConfigured()) return false;
  const snapshot = await firestoreDb().collection(MIGRATION_COLLECTION).doc('catalog-v1').get();
  return snapshot.get('complete') === true;
}

export async function markFirestoreImageCatalogMigrated(): Promise<void> {
  await firestoreDb().collection(MIGRATION_COLLECTION).doc('catalog-v1').set({
    complete: true,
    updatedAt: new Date().toISOString(),
  });
}

export async function readFirestoreImageAssets(): Promise<ImageAsset[] | null> {
  if (!isFirestoreConfigured()) return null;
  const snapshot = await firestoreDb().collection(ASSET_COLLECTION).get();
  return snapshot.docs.map((document) => document.data() as ImageAsset);
}

export async function writeFirestoreImageAssetChanges(
  upserts: ImageAsset[],
  deletes: string[]
): Promise<void> {
  if (!isFirestoreConfigured()) throw new Error('Firestore is not configured.');
  const db = firestoreDb();
  const operations = [
    ...upserts.map((asset) => ({ kind: 'set' as const, asset })),
    ...deletes.map((id) => ({ kind: 'delete' as const, id })),
  ];
  for (let start = 0; start < operations.length; start += 450) {
    const batch = db.batch();
    for (const operation of operations.slice(start, start + 450)) {
      if (operation.kind === 'set') {
        const encoded = JSON.stringify(operation.asset);
        if (Buffer.byteLength(encoded, 'utf8') > 850_000) {
          throw new Error(`Image metadata for “${operation.asset.id}” exceeds Firestore's document size limit.`);
        }
        batch.set(db.collection(ASSET_COLLECTION).doc(operation.asset.id), JSON.parse(encoded) as ImageAsset);
      } else {
        batch.delete(db.collection(ASSET_COLLECTION).doc(operation.id));
      }
    }
    await batch.commit();
  }
}

export interface FirestoreImageUploadIntent {
  id: string;
  expectedPath: string;
  completionHash: string;
  expiresAt: number;
  status: 'issued' | 'processing' | 'complete';
  leaseUntil?: number;
  imageKitFileId?: string;
  createdAt: string;
}

export async function createFirestoreImageUploadIntent(intent: FirestoreImageUploadIntent): Promise<void> {
  const ref = firestoreDb().collection('imageUploadIntents').doc(intent.id);
  await firestoreDb().runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) throw new Error('Upload authorization collision. Please retry.');
    transaction.create(ref, { ...intent, expireAt: new Date(intent.expiresAt) });
  });
}

function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function claimFirestoreImageUploadIntent(input: {
  id: string;
  completionHash: string;
  actualPath: string;
  imageKitFileId: string;
  now?: number;
}): Promise<FirestoreImageUploadIntent | null> {
  const db = firestoreDb();
  const ref = db.collection('imageUploadIntents').doc(input.id);
  const now = input.now ?? Date.now();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const intent = snapshot.data() as FirestoreImageUploadIntent;
    if (intent.status === 'complete' || intent.expiresAt <= now ||
        intent.expectedPath !== input.actualPath || !equalHash(intent.completionHash, input.completionHash)) {
      return null;
    }
    if (intent.status === 'processing' && (intent.leaseUntil ?? 0) > now) return null;
    const claimed = {
      ...intent,
      status: 'processing' as const,
      leaseUntil: now + 2 * 60 * 1000,
      imageKitFileId: input.imageKitFileId,
    };
    transaction.update(ref, claimed);
    return claimed;
  });
}

export async function completeFirestoreImageUploadIntent(id: string, imageKitFileId: string): Promise<void> {
  const db = firestoreDb();
  const ref = db.collection('imageUploadIntents').doc(id);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('Image upload authorization has expired.');
    const intent = snapshot.data() as FirestoreImageUploadIntent;
    if (intent.status !== 'processing' || intent.imageKitFileId !== imageKitFileId) {
      throw new Error('Image upload authorization is no longer valid.');
    }
    transaction.update(ref, {
      status: 'complete',
      completedAt: new Date().toISOString(),
      expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  });
}

export async function releaseFirestoreImageUploadIntent(id: string, imageKitFileId?: string): Promise<void> {
  const db = firestoreDb();
  const ref = db.collection('imageUploadIntents').doc(id);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const intent = snapshot.data() as FirestoreImageUploadIntent;
    if (intent.status !== 'complete' && (!imageKitFileId || intent.imageKitFileId === imageKitFileId)) {
      transaction.update(ref, { status: 'issued', leaseUntil: null, imageKitFileId: null });
    }
  });
}
