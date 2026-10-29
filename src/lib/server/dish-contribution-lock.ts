/** Cross-instance dish reservations backed by unique Vercel Blob pathnames. */
import { BlobPreconditionFailedError, del, get, list, put } from '@vercel/blob';
import { isBlobStorageConfigured } from '../storage/persistent-json.js';

const heldLocally = new Set<string>();
const heldDailySlots = new Set<string>();
const localDishReservations = new Map<string, string>();

function lockPath(slug: string): string {
  return `app-data/dish-locks/${slug}.json`;
}

export class DishContributionLockedError extends Error {
  constructor(message = 'A contribution for this dish is already pending or published. Duplicate dish submissions are locked.') {
    super(message);
    this.name = 'DishContributionLockedError';
  }
}

export class ContributorDailyLimitError extends Error {
  constructor(limit: number) {
    super(`Daily contribution limit reached (${limit} per UTC day). Try again after the daily reset.`);
    this.name = 'ContributorDailyLimitError';
  }
}

export class DishContributionLockUnavailableError extends Error {
  constructor() {
    super('Could not verify the dish submission lock. Please retry in a moment.');
    this.name = 'DishContributionLockUnavailableError';
  }
}

export interface ContributorDailySlot {
  key: string;
  path?: string;
  reservationId: string;
}

interface LockRecord {
  reservationId: string;
  createdAt: string;
  committed?: boolean;
}

const IN_PROGRESS_TTL_MS = 10 * 60 * 1000;

function isBlobPathConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!error || typeof error !== 'object') return false;

  const details = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  if (details.code === 'precondition_failed' || details.status === 412 || details.statusCode === 412) return true;
  return typeof details.message === 'string' && /already exists|precondition failed|etag mismatch/iu.test(details.message);
}

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readLock(pathname: string): Promise<{ record: LockRecord; etag: string } | null> {
  const stored = await get(pathname, { access: 'private', useCache: false });
  if (!stored || stored.statusCode !== 200) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
  try {
    const record = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Partial<LockRecord>;
    if (typeof record.reservationId !== 'string' || typeof record.createdAt !== 'string') return null;
    return { record: record as LockRecord, etag: stored.blob.etag };
  } catch {
    return null;
  }
}

function isExpiredReservation(record: LockRecord): boolean {
  const createdAt = Date.parse(record.createdAt);
  return record.committed !== true && Number.isFinite(createdAt) && Date.now() - createdAt > IN_PROGRESS_TTL_MS;
}

async function commitLock(pathname: string, reservationId: string): Promise<void> {
  const current = await readLock(pathname);
  if (!current || current.record.reservationId !== reservationId) {
    throw new Error('The upload reservation expired before it could be committed.');
  }
  if (current.record.committed) return;
  await put(pathname, JSON.stringify({ ...current.record, committed: true, committedAt: new Date().toISOString() }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    ifMatch: current.etag,
    contentType: 'application/json',
  });
}

async function releaseLock(pathname: string, reservationId?: string): Promise<void> {
  if (!isBlobStorageConfigured()) return;
  if (!reservationId) {
    await del(pathname);
    return;
  }
  const current = await readLock(pathname);
  if (!current || current.record.reservationId !== reservationId) return;
  await del(pathname, { ifMatch: current.etag });
}

/**
 * Reserve a normalized dish name before image processing begins. In production,
 * Vercel Blob's no-overwrite write provides an atomic cross-function lock.
 */
export async function acquireDishContributionLock(
  slug: string,
  reservationId: string,
  hasBlockingCatalogAsset: () => Promise<boolean>
): Promise<void> {
  const pathname = lockPath(slug);
  if (!isBlobStorageConfigured()) {
    if (heldLocally.has(slug)) throw new DishContributionLockedError();
    heldLocally.add(slug);
    localDishReservations.set(slug, reservationId);
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await put(pathname, JSON.stringify({ reservationId, createdAt: new Date().toISOString() }), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json',
      });
      return;
    } catch (error) {
      if (!isBlobPathConflict(error)) throw new DishContributionLockUnavailableError();
      let current: Awaited<ReturnType<typeof readLock>>;
      try {
        current = await readLock(pathname);
      } catch {
        throw new DishContributionLockUnavailableError();
      }
      if (!current) continue;
      if (current.record.committed) {
        let catalogHasDish: boolean;
        try {
          catalogHasDish = await hasBlockingCatalogAsset();
        } catch {
          throw new DishContributionLockUnavailableError();
        }
        if (catalogHasDish) throw new DishContributionLockedError();
      } else if (!isExpiredReservation(current.record)) {
        throw new DishContributionLockedError();
      }
      try {
        await del(pathname, { ifMatch: current.etag });
      } catch (deleteError) {
        if (!(deleteError instanceof BlobPreconditionFailedError)) {
          throw new DishContributionLockUnavailableError();
        }
      }
    }
  }
  throw new DishContributionLockUnavailableError();
}

/** Keep the reservation after persistence; release it for denied/failed work. */
export async function commitDishContributionLock(slug: string, reservationId: string): Promise<void> {
  if (isBlobStorageConfigured()) await commitLock(lockPath(slug), reservationId);
}

export async function releaseDishContributionLock(slug: string, reservationId?: string): Promise<void> {
  heldLocally.delete(slug);
  if (reservationId && localDishReservations.get(slug) !== reservationId) return;
  localDishReservations.delete(slug);
  await releaseLock(lockPath(slug), reservationId);
}

/** Reserve one contributor quota slot atomically across Vercel instances. */
export async function acquireContributorDailySlot(
  contributorId: string,
  reservationId: string,
  limit = 3
): Promise<ContributorDailySlot> {
  const day = currentUtcDay();
  const keyPrefix = `${contributorId}:${day}:`;
  if (!isBlobStorageConfigured()) {
    for (let slot = 1; slot <= limit; slot += 1) {
      const key = `${keyPrefix}${slot}`;
      if (heldDailySlots.has(key)) continue;
      heldDailySlots.add(key);
      return { key, reservationId };
    }
    throw new ContributorDailyLimitError(limit);
  }

  const pathPrefix = `app-data/contributor-rate-limits/${contributorId}/`;
  // Remove expired day records on the contributor's next use to prevent
  // unbounded marker growth while keeping the active day's reservations atomic.
  let cursor: string | undefined;
  let hasMore = true;
  const expiredPaths: string[] = [];
  while (hasMore) {
    const page = await list({ prefix: pathPrefix, limit: 1000, cursor });
    for (const blob of page.blobs) {
      if (!blob.pathname.startsWith(`${pathPrefix}${day}/`)) expiredPaths.push(blob.pathname);
    }
    hasMore = page.hasMore;
    cursor = page.cursor;
  }
  if (expiredPaths.length) await del(expiredPaths);

  for (let slot = 1; slot <= limit; slot += 1) {
    const pathname = `${pathPrefix}${day}/${slot}.json`;
    try {
      await put(pathname, JSON.stringify({ reservationId, createdAt: new Date().toISOString() }), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json',
      });
      return { key: `${keyPrefix}${slot}`, path: pathname, reservationId };
    } catch (error) {
      if (!isBlobPathConflict(error)) throw error;
      const current = await readLock(pathname);
      if (!current || !isExpiredReservation(current.record)) continue;
      try {
        await del(pathname, { ifMatch: current.etag });
      } catch (deleteError) {
        if (!(deleteError instanceof BlobPreconditionFailedError)) throw deleteError;
      }
      slot -= 1;
    }
  }
  throw new ContributorDailyLimitError(limit);
}

/** Commit a slot by leaving its daily marker; release it when work fails. */
export async function releaseContributorDailySlot(slot: ContributorDailySlot): Promise<void> {
  heldDailySlots.delete(slot.key);
  if (slot.path) await releaseLock(slot.path, slot.reservationId);
}

export async function commitContributorDailySlot(slot: ContributorDailySlot): Promise<void> {
  if (slot.path) await commitLock(slot.path, slot.reservationId);
}
