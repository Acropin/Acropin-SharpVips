/** Persistent GitHub contributor profiles and access decisions. */
import { del, list } from '@vercel/blob';
import { getAppDataFile } from '../storage/data-directory.js';
import { isBlobStorageConfigured, readPersistentJson, writePersistentJson } from '../storage/persistent-json.js';

export type ContributorAccessStatus = 'pending' | 'active' | 'blocked';

export interface ContributorProfile {
  id: string;
  githubId: string;
  login: string;
  name?: string;
  avatarUrl: string;
  profileUrl: string;
  accessStatus: ContributorAccessStatus;
  contributionCount: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

const dataFile = () => getAppDataFile('contributors.json');
const accessFile = (id: string) => getAppDataFile('contributor-access', `${id}.json`);
let profiles: ContributorProfile[] = [];
let initialized = false;
let initPromise: Promise<void> | null = null;
let pendingSave: Promise<void> = Promise.resolve();

function isProfile(value: unknown): value is ContributorProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Partial<ContributorProfile>;
  return typeof profile.id === 'string' && typeof profile.githubId === 'string' &&
    typeof profile.login === 'string' && typeof profile.avatarUrl === 'string' &&
    typeof profile.profileUrl === 'string' && ['pending', 'active', 'blocked'].includes(String(profile.accessStatus)) &&
    Number.isInteger(profile.contributionCount) && typeof profile.createdAt === 'string' &&
    typeof profile.updatedAt === 'string' && typeof profile.lastLoginAt === 'string';
}

function isAccessRecord(value: unknown): value is { status: ContributorAccessStatus; updatedAt: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const access = value as { status?: unknown; updatedAt?: unknown };
  return ['pending', 'active', 'blocked'].includes(String(access.status)) && typeof access.updatedAt === 'string';
}

function persist(changed: ContributorProfile): void {
  const changedProfile = { ...changed };
  const snapshot = profiles.map((profile) => ({ ...profile }));
  pendingSave = pendingSave.catch(() => undefined).then(async () => {
    if (!isBlobStorageConfigured()) {
      await writePersistentJson('app-data/contributors.json', dataFile(), snapshot);
      return;
    }
    // A separate object per GitHub identity avoids concurrent sign-ins
    // overwriting another contributor's entire account collection.
    await writePersistentJson(
      `app-data/contributors/${changedProfile.id}.json`,
      getAppDataFile('contributors', `${changedProfile.id}.json`),
      changedProfile
    );
  });
}

export async function initializeContributors(): Promise<void> {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      if (!isBlobStorageConfigured()) {
        const stored = await readPersistentJson<unknown>('app-data/contributors.json', dataFile());
        if (stored !== null && (!Array.isArray(stored) || !stored.every(isProfile))) {
          throw new Error('Contributor profile storage is invalid. Fix it before accepting GitHub sign-ins.');
        }
        profiles = (stored ?? []) as ContributorProfile[];
        let migrated = false;
        profiles = profiles.map((profile) => {
          if (profile.accessStatus !== 'pending') return profile;
          migrated = true;
          return { ...profile, accessStatus: 'active', updatedAt: new Date().toISOString() };
        });
        if (migrated) {
          await writePersistentJson('app-data/contributors.json', dataFile(), profiles);
        }
      } else {
        const legacy = await readPersistentJson<unknown>('app-data/contributors.json', dataFile());
        if (legacy !== null && (!Array.isArray(legacy) || !legacy.every(isProfile))) {
          throw new Error('Legacy contributor storage is invalid. Fix it before accepting GitHub sign-ins.');
        }
        const storedProfiles = new Map<string, ContributorProfile>();
        let cursor: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const page = await list({ prefix: 'app-data/contributors/', limit: 1000, cursor });
          const profileBlobs = page.blobs.filter((blob) => blob.pathname.endsWith('.json'));
          const records = await Promise.all(profileBlobs.map(async (blob) => {
            const id = blob.pathname.slice('app-data/contributors/'.length, -'.json'.length);
            if (!/^github_\d+$/u.test(id)) return null;
            return readPersistentJson<unknown>(blob.pathname, getAppDataFile('contributors', `${id}.json`));
          }));
          for (const record of records) {
            if (record !== null) {
              if (!isProfile(record)) throw new Error('A stored GitHub contributor profile is invalid.');
              storedProfiles.set(record.id, record);
            }
          }
          hasMore = page.hasMore;
          cursor = page.cursor;
        }
        for (const profile of (legacy ?? []) as ContributorProfile[]) {
          if (!storedProfiles.has(profile.id)) storedProfiles.set(profile.id, profile);
        }
        profiles = [...storedProfiles.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        if (legacy !== null) {
          await Promise.all([...storedProfiles.values()].map((profile) => writePersistentJson(
            `app-data/contributors/${profile.id}.json`,
            getAppDataFile('contributors', `${profile.id}.json`),
            profile
          )));
          await del('app-data/contributors.json');
        }
      }
      initialized = true;
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

function cacheProfile(profile: ContributorProfile): void {
  const index = profiles.findIndex((candidate) => candidate.id === profile.id);
  if (index === -1) profiles.push(profile);
  else profiles[index] = profile;
}

export async function getContributorById(id: string): Promise<ContributorProfile | undefined> {
  if (!/^github_\d+$/u.test(id)) return undefined;
  if (!isBlobStorageConfigured()) {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) return undefined;
    // Profiles created before automatic access was enabled were stored as
    // pending. A valid GitHub session now grants contributor access directly.
    if (profile.accessStatus === 'pending') {
      profile.accessStatus = 'active';
      profile.updatedAt = new Date().toISOString();
      persist(profile);
    }
    return { ...profile };
  }
  const stored = await readPersistentJson<unknown>(
    `app-data/contributors/${id}.json`,
    getAppDataFile('contributors', `${id}.json`)
  );
  if (stored === null) {
    profiles = profiles.filter((profile) => profile.id !== id);
    return undefined;
  }
  if (!isProfile(stored)) throw new Error('A stored GitHub contributor profile is invalid.');
  const storedAccess = await readPersistentJson<unknown>(
    `app-data/contributor-access/${id}.json`, accessFile(id)
  );
  if (storedAccess !== null && !isAccessRecord(storedAccess)) {
    throw new Error('A stored GitHub contributor access record is invalid.');
  }
  const accessStatus = isAccessRecord(storedAccess) ? storedAccess.status : stored.accessStatus;
  const profile = { ...stored, accessStatus: accessStatus === 'pending' ? 'active' : accessStatus };
  cacheProfile(profile);
  if (accessStatus === 'pending') {
    // Migrate legacy pending profile/access records so subsequent requests
    // continue to see the automatic access decision.
    await writePersistentJson(
      `app-data/contributor-access/${id}.json`,
      accessFile(id),
      { status: 'active', updatedAt: new Date().toISOString() }
    );
    if (stored.accessStatus === 'pending') persist(profile);
  }
  return { ...profile };
}

export async function upsertGitHubContributor(input: {
  githubId: string;
  login: string;
  name?: string;
  avatarUrl: string;
  profileUrl: string;
}): Promise<ContributorProfile> {
  const now = new Date().toISOString();
  const id = `github_${input.githubId}`;
  const existing = await getContributorById(id) || profiles.find((profile) => profile.githubId === input.githubId);
  if (existing) {
    existing.login = input.login;
    existing.name = input.name || undefined;
    existing.avatarUrl = input.avatarUrl;
    existing.profileUrl = input.profileUrl;
    existing.lastLoginAt = now;
    existing.updatedAt = now;
    // New GitHub sign-ins are contributors immediately. Explicitly blocked
    // accounts remain blocked until an administrator reactivates them.
    if (existing.accessStatus !== 'blocked') existing.accessStatus = 'active';
    persist(existing);
    return { ...existing };
  }

  const created: ContributorProfile = {
    id: `github_${input.githubId}`,
    githubId: input.githubId,
    login: input.login,
    name: input.name || undefined,
    avatarUrl: input.avatarUrl,
    profileUrl: input.profileUrl,
    accessStatus: 'active',
    contributionCount: 0,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  profiles.unshift(created);
  persist(created);
  return { ...created };
}

export async function listContributors(): Promise<ContributorProfile[]> {
  if (isBlobStorageConfigured()) {
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await list({ prefix: 'app-data/contributors/', limit: 1000, cursor });
        const records = await Promise.all(page.blobs.filter((blob) => blob.pathname.endsWith('.json')).map(async (blob) => {
        const id = blob.pathname.slice('app-data/contributors/'.length, -'.json'.length);
        if (!/^github_\d+$/u.test(id)) return null;
        return readPersistentJson<unknown>(blob.pathname, getAppDataFile('contributors', `${id}.json`));
      }));
      for (const record of records) {
        if (record !== null) {
          if (!isProfile(record)) throw new Error('A stored GitHub contributor profile is invalid.');
          const access = await readPersistentJson<unknown>(`app-data/contributor-access/${record.id}.json`, accessFile(record.id));
          if (access !== null && !isAccessRecord(access)) throw new Error('A stored GitHub contributor access record is invalid.');
          const accessStatus = isAccessRecord(access) ? access.status : record.accessStatus;
          const profile = { ...record, accessStatus: accessStatus === 'pending' ? 'active' : accessStatus };
          cacheProfile(profile);
          if (accessStatus === 'pending') {
            await writePersistentJson(
              `app-data/contributor-access/${record.id}.json`,
              accessFile(record.id),
              { status: 'active', updatedAt: new Date().toISOString() }
            );
            if (record.accessStatus === 'pending') persist(profile);
          }
        }
      }
      hasMore = page.hasMore;
      cursor = page.cursor;
    }
  }
  return profiles.map((profile) => ({ ...profile }));
}

export async function updateContributorAccess(id: string, status: ContributorAccessStatus): Promise<ContributorProfile | undefined> {
  const profile = await getContributorById(id);
  if (!profile) return undefined;
  profile.accessStatus = status;
  profile.updatedAt = new Date().toISOString();
  cacheProfile(profile);
  if (isBlobStorageConfigured()) {
    pendingSave = pendingSave.catch(() => undefined).then(() => writePersistentJson(
      `app-data/contributor-access/${profile.id}.json`,
      accessFile(profile.id),
      { status, updatedAt: profile.updatedAt }
    ));
  } else {
    persist(profile);
  }
  return { ...profile };
}

export function recordContributorSubmission(id: string): void {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) return;
  profile.contributionCount += 1;
  profile.updatedAt = new Date().toISOString();
  persist(profile);
}

export async function flushContributors(): Promise<void> {
  await pendingSave;
}
