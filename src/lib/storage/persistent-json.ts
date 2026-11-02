/**
 * Durable JSON storage for server data.
 *
 * Firestore is the production source of truth. Legacy Vercel Blob objects are
 * imported once, per pathname, and are never deleted by this adapter. The
 * local filesystem and Blob-only paths remain available for development and
 * the one-time recovery window.
 */
import { createHash, randomUUID } from 'node:crypto';
import { get, list, put } from '@vercel/blob';
import fs from 'node:fs/promises';
import path from 'node:path';
import { firestoreDb, isFirestoreConfigured } from './firestore.js';

const SNAPSHOT_COLLECTION = 'persistentJsonSnapshots';
const CHUNK_COLLECTION = 'persistentJsonSnapshotChunks';
const MIGRATION_COLLECTION = 'persistentJsonMigrations';
const MAX_CHUNK_BYTES = 600_000;
const MAX_BATCH_WRITES = 450;
const COMPLETED_MIGRATION_PREFIXES = [
  'app-data/contributors/',
  'app-data/contributor-access/',
] as const;

type SnapshotHead = {
  path: string;
  version: string;
  chunkCount: number;
  byteLength: number;
  sha256: string;
  updatedAt: string;
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function snapshotId(pathname: string): string {
  return digest(pathname);
}

function migrationDocumentId(pathname: string): string {
  return `json-${snapshotId(pathname)}`;
}

function prefixMigrationDocumentId(prefix: string): string {
  return `prefix-${snapshotId(prefix)}`;
}

function chunkDocumentId(snapshot: string, version: string, index: number): string {
  return `${snapshot}_${version}_${index.toString().padStart(5, '0')}`;
}

function validatePathname(pathname: string): void {
  if (!pathname || pathname.startsWith('/') || pathname.includes('..') || pathname.includes('\\')) {
    throw new Error('Persistent JSON path is invalid.');
  }
}

export function isBlobStorageConfigured(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  const hasStaticToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  const hasOidcConnection = Boolean(
    process.env.BLOB_STORE_ID?.trim() && process.env.VERCEL_OIDC_TOKEN?.trim()
  );
  return hasStaticToken || hasOidcConnection;
}

/** True when a durable provider is available for application state. */
export function isPersistentJsonStorageConfigured(): boolean {
  return isFirestoreConfigured() || isBlobStorageConfigured() || process.env.VERCEL !== '1';
}

async function readBlobJson<T>(blobPath: string): Promise<T | null> {
  const result = await get(blobPath, { access: 'private', useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) {
    throw new Error(`Could not read legacy persistent object “${blobPath}”.`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

async function readLocalJson<T>(localPath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(localPath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function isPathMigrated(pathname: string): Promise<boolean> {
  const snapshot = await firestoreDb().collection(MIGRATION_COLLECTION).doc(migrationDocumentId(pathname)).get();
  return snapshot.get('complete') === true;
}

async function isPathCoveredByCompletedPrefix(pathname: string): Promise<boolean> {
  for (const prefix of COMPLETED_MIGRATION_PREFIXES) {
    if (!pathname.startsWith(prefix)) continue;
    const snapshot = await firestoreDb().collection(MIGRATION_COLLECTION)
      .doc(prefixMigrationDocumentId(prefix)).get();
    if (snapshot.get('complete') === true) return true;
  }
  return false;
}

async function readFirestoreSnapshot<T>(pathname: string): Promise<T | null> {
  const db = firestoreDb();
  const headRef = db.collection(SNAPSHOT_COLLECTION).doc(snapshotId(pathname));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headSnapshot = await headRef.get();
    if (!headSnapshot.exists) return null;

    const head = headSnapshot.data() as Partial<SnapshotHead>;
    if (head.path !== pathname || typeof head.version !== 'string' ||
        !Number.isInteger(head.chunkCount) || (head.chunkCount ?? 0) < 1 ||
        !Number.isInteger(head.byteLength) || (head.byteLength ?? -1) < 0 ||
        typeof head.sha256 !== 'string') {
      throw new Error(`Persistent Firestore snapshot metadata is invalid for “${pathname}”.`);
    }

    const chunkCount = head.chunkCount as number;
    const byteLength = head.byteLength as number;
    const sha256 = head.sha256;
    const version = head.version;
    try {
      const buffers: Buffer[] = [];
      for (let start = 0; start < chunkCount; start += MAX_BATCH_WRITES) {
        const end = Math.min(chunkCount, start + MAX_BATCH_WRITES);
        const refs = Array.from({ length: end - start }, (_, offset) => db.collection(CHUNK_COLLECTION)
          .doc(chunkDocumentId(snapshotId(pathname), version, start + offset)));
        const documents = await db.getAll(...refs);
        for (let offset = 0; offset < documents.length; offset += 1) {
          const document = documents[offset];
          const chunk = document.data() as { index?: unknown; data?: unknown } | undefined;
          if (!document.exists || chunk?.index !== start + offset || typeof chunk.data !== 'string') {
            throw new Error(`Persistent Firestore snapshot is incomplete for “${pathname}”.`);
          }
          buffers.push(Buffer.from(chunk.data, 'base64'));
        }
      }

      const bytes = Buffer.concat(buffers);
      if (bytes.length !== byteLength || digest(bytes.toString('base64')) !== sha256) {
        throw new Error(`Persistent Firestore snapshot checksum failed for “${pathname}”.`);
      }
      const currentHead = await headRef.get();
      if (currentHead.get('version') !== version) continue;
      return JSON.parse(bytes.toString('utf8')) as T;
    } catch (error) {
      const currentHead = await headRef.get();
      if (attempt < 2 && currentHead.get('version') !== version) continue;
      throw error;
    }
  }
  throw new Error(`Persistent Firestore snapshot changed repeatedly while reading “${pathname}”.`);
}

async function deleteSnapshotVersion(pathname: string, version: string, chunkCount: number): Promise<void> {
  const db = firestoreDb();
  const snapshot = snapshotId(pathname);
  for (let start = 0; start < chunkCount; start += MAX_BATCH_WRITES) {
    const batch = db.batch();
    const end = Math.min(chunkCount, start + MAX_BATCH_WRITES);
    for (let index = start; index < end; index += 1) {
      batch.delete(db.collection(CHUNK_COLLECTION).doc(chunkDocumentId(snapshot, version, index)));
    }
    await batch.commit();
  }
}

async function commitFirestoreSnapshot(pathname: string, value: unknown, mode: 'import' | 'write'): Promise<void> {
  const db = firestoreDb();
  const headRef = db.collection(SNAPSHOT_COLLECTION).doc(snapshotId(pathname));
  const migrationRef = db.collection(MIGRATION_COLLECTION).doc(migrationDocumentId(pathname));
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error(`Persistent value for “${pathname}” is not JSON serializable.`);
  const bytes = Buffer.from(json, 'utf8');
  const chunks: Buffer[] = [];
  if (value !== null) {
    for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_BYTES) {
      chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + MAX_CHUNK_BYTES)));
    }
  }
  const version = randomUUID();
  const snapshot = snapshotId(pathname);

  for (let start = 0; start < chunks.length; start += MAX_BATCH_WRITES) {
    const batch = db.batch();
    const end = Math.min(chunks.length, start + MAX_BATCH_WRITES);
    for (let index = start; index < end; index += 1) {
      batch.create(db.collection(CHUNK_COLLECTION).doc(chunkDocumentId(snapshot, version, index)), {
        index,
        data: chunks[index].toString('base64'),
      });
    }
    await batch.commit();
  }

  let previousVersion: string | undefined;
  let previousChunkCount = 0;
  let committed = false;
  try {
    committed = await db.runTransaction(async (transaction) => {
      // Read both documents before any writes in the Firestore transaction.
      const [migration, oldHead] = await Promise.all([
        transaction.get(migrationRef),
        transaction.get(headRef),
      ]);
      const isMigrated = migration.get('complete') === true;
      if (mode === 'import' && isMigrated) return false;
      if (mode === 'import' && oldHead.exists) {
        throw new Error(`A Firestore snapshot exists without a completed import marker for “${pathname}”; refusing to overwrite it.`);
      }
      if (mode === 'write' && !isMigrated) {
        throw new Error(`Legacy import must finish before “${pathname}” can be changed.`);
      }
      const old = oldHead.data() as Partial<SnapshotHead> | undefined;
      previousVersion = typeof old?.version === 'string' ? old.version : undefined;
      previousChunkCount = Number.isInteger(old?.chunkCount) ? old?.chunkCount as number : 0;

      if (value !== null) {
        transaction.set(headRef, {
          path: pathname,
          version,
          chunkCount: chunks.length,
          byteLength: bytes.length,
          sha256: digest(bytes.toString('base64')),
          updatedAt: new Date().toISOString(),
        } satisfies SnapshotHead);
      } else {
        transaction.delete(headRef);
      }
      transaction.set(migrationRef, {
        path: pathname,
        complete: true,
        updatedAt: new Date().toISOString(),
      });
      return true;
    });
  } finally {
    if (!committed) await deleteSnapshotVersion(pathname, version, chunks.length).catch(() => undefined);
  }

  if (previousVersion && previousVersion !== version && previousChunkCount > 0) {
    await deleteSnapshotVersion(pathname, previousVersion, previousChunkCount);
  }
}

async function importLegacyJson<T>(blobPath: string, localPath: string): Promise<T | null> {
  validatePathname(blobPath);
  let legacy: T | null;
  const coveredByCompletedPrefix = isFirestoreConfigured() &&
    await isPathCoveredByCompletedPrefix(blobPath);
  if (coveredByCompletedPrefix) {
    // Prefix migration enumerated every legacy object. A new path under that
    // prefix can be initialized without another Blob operation.
    legacy = null;
  } else if (isBlobStorageConfigured()) {
    legacy = await readBlobJson<T>(blobPath);
  } else if (process.env.VERCEL === '1') {
    throw new Error(`Legacy data source is not available for “${blobPath}”; refusing to initialize an empty store.`);
  } else {
    legacy = await readLocalJson<T>(localPath);
  }
  await commitFirestoreSnapshot(blobPath, legacy, 'import');
  return readFirestoreSnapshot<T>(blobPath);
}

export async function readPersistentJson<T>(blobPath: string, localPath: string): Promise<T | null> {
  validatePathname(blobPath);
  if (isFirestoreConfigured()) {
    if (await isPathMigrated(blobPath)) return readFirestoreSnapshot<T>(blobPath);
    return importLegacyJson<T>(blobPath, localPath);
  }
  if (isBlobStorageConfigured()) return readBlobJson<T>(blobPath);
  return readLocalJson<T>(localPath);
}

export async function writePersistentJson<T>(blobPath: string, localPath: string, value: T): Promise<void> {
  validatePathname(blobPath);
  if (isFirestoreConfigured()) {
    if (!(await isPathMigrated(blobPath))) await readPersistentJson(blobPath, localPath);
    await commitFirestoreSnapshot(blobPath, value, 'write');
    return;
  }
  if (isBlobStorageConfigured()) {
    await put(blobPath, JSON.stringify(value), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: 'application/json',
    });
    return;
  }

  if (process.env.VERCEL === '1' && process.env.NODE_ENV !== 'test') {
    throw new Error('Persistent storage is not configured. Connect Firestore or the legacy Vercel Blob store to this project.');
  }

  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, JSON.stringify(value, null, 2), 'utf8');
}

/** Read-only listing used to import legacy per-contributor JSON objects once. */
export async function listPersistentJsonPaths(prefix: string): Promise<string[]> {
  if (!isFirestoreConfigured()) return [];
  const snapshot = await firestoreDb().collection(SNAPSHOT_COLLECTION)
    .where('path', '>=', prefix)
    .where('path', '<', `${prefix}\uf8ff`)
    .orderBy('path')
    .get();
  return snapshot.docs
    .map((document) => document.get('path'))
    .filter((pathname): pathname is string => typeof pathname === 'string');
}

export async function isPersistentJsonPrefixMigrated(prefix: string): Promise<boolean> {
  if (!isFirestoreConfigured()) return false;
  const snapshot = await firestoreDb().collection(MIGRATION_COLLECTION).doc(prefixMigrationDocumentId(prefix)).get();
  return snapshot.get('complete') === true;
}

export async function markPersistentJsonPrefixMigrated(prefix: string): Promise<void> {
  if (!isFirestoreConfigured()) throw new Error('Firestore is not configured.');
  await firestoreDb().collection(MIGRATION_COLLECTION).doc(prefixMigrationDocumentId(prefix)).set({
    prefix,
    complete: true,
    updatedAt: new Date().toISOString(),
  });
}
