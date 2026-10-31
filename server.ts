/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { processFoodImage } from './src/lib/images/process-image.js';
import { StorageError } from './src/lib/images/errors.js';
import { getStorageProvider } from './src/lib/storage/image-storage.js';
import {
  initializeCatalog,
  DuplicateAssetError,
  getAllAssets,
  getAssetById,
  findAssetByHash,
  findSimilarAssetByPerceptualHash,
  PerceptualIndexUnavailableError,
  findBlockingAssetBySlug,
  refreshCatalogFromStorage,
  registerAsset,
  deleteAsset,
  isPackageAsset,
  updateAssetStatus,
  flushCatalog,
} from './src/lib/server/catalog-store.js';
import { MAX_PERCEPTUAL_DUPLICATE_DISTANCE } from './src/lib/images/perceptual-hash.js';
import {
  ContributorDailyLimitError,
  DishContributionLockedError,
  DishContributionLockUnavailableError,
  commitContributorDailySlot,
  commitDishContributionLock,
  acquireContributorDailySlot,
  acquireDishContributionLock,
  releaseContributorDailySlot,
  releaseDishContributionLock,
  type ContributorDailySlot,
} from './src/lib/server/dish-contribution-lock.js';
import {
  flushContributors,
  getContributorById,
  initializeContributors,
  listContributors,
  recordContributorSubmission,
  updateContributorAccess,
  upsertGitHubContributor,
  type ContributorAccessStatus,
  type ContributorProfile,
} from './src/lib/server/contributor-store.js';
import { toUniversalFoodName } from './src/lib/images/universal-naming.js';
import {
  initializeRestaurants,
  getAllRestaurants,
  getRestaurantMenu,
  updateMenuItemAssignment,
  handleAssetRevocation,
  flushRestaurantStore,
} from './src/lib/server/restaurant-store.js';
import { CANONICAL_DISHES } from './src/lib/catalog/canonical-dishes.js';
import { matchCanonicalDish } from './src/lib/catalog/matcher.js';
import { generateImportPreview, commitMenuImport } from './src/lib/import/menu-importer.js';
import { parseDatasetTargetImport } from './src/lib/import/dataset-target-import.js';
import { inspectFoodImageWithMl } from './src/lib/server/ml-anti-corruption.js';
import { fetchRemoteImage } from './src/lib/server/remote-image.js';
import { canReadImageAsset } from './src/lib/server/image-authorization.js';
import { buildMonthlyContributorLeaderboard } from './src/lib/server/contributor-rewards.js';
import { isBlobStorageConfigured } from './src/lib/storage/persistent-json.js';
import {
  initializeTargetDataset,
  getAllTargetItems,
  addTargetItem,
  bulkImportTargets,
  deleteTargetItem,
  computeDatasetStatus,
  flushTargets,
  withFreshTargetDataset,
} from './src/lib/server/dataset-target-store.js';
import type {
  AssetApprovalStatus,
  ImageAsset,
  LicenseType,
  ProcessedImageOnDemandResult,
  ProcessedImageResult,
} from './src/lib/images/types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const vercelRequestLimit = process.env.VERCEL === '1' ? '4mb' : '10mb';
const DISALLOWED_IMAGE_HOSTS = [
  'unsplash.com',
  'pexels.com',
  'shutterstock.com',
  'gettyimages.com',
  'istockphoto.com',
  'adobe.com',
  'freepik.com',
];

type CommunityLicense = Extract<LicenseType, 'CC0' | 'CC-BY-4.0'>;

interface RightsSubmission {
  licenseType: CommunityLicense;
  licenseEvidence: string;
  sourceUrl?: string;
  requiredAttribution?: string;
  contributorGitHub?: string;
}

interface PersistProcessedAssetInput {
  processed: ProcessedImageResult | ProcessedImageOnDemandResult;
  sourceBuffer: Buffer;
  dishName: string;
  universalName: string;
  filename: string;
  canonicalDishId?: string;
  originalByteSize: number;
  rights: RightsSubmission;
  mlInspection: Awaited<ReturnType<typeof inspectFoodImageWithMl>>;
  approvalStatus: AssetApprovalStatus;
  sourceTag: string;
  contributorId?: string;
}

type RequestAccess = { role: 'admin' } | { role: 'contributor'; profile: ContributorProfile };
const requestAccess = new WeakMap<express.Request, RequestAccess>();
const SESSION_COOKIE = 'acropin_github_session';
const OAUTH_STATE_COOKIE = 'acropin_github_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
// Stable GitHub account ID from the owner's GitHub profile. This can be
// overridden when ownership changes without relying on a mutable username.
const DEFAULT_GITHUB_OWNER_ID = '116822525';

function isGitHubOwner(profile: ContributorProfile | undefined): boolean {
  if (!profile) return false;
  const ownerId = process.env.GITHUB_OWNER_ID?.trim() || DEFAULT_GITHUB_OWNER_ID;
  return profile.githubId === ownerId;
}

function getGitHubOAuthConfig() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() || '';
  const callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL?.trim() || '';
  const sessionSecret = process.env.GITHUB_SESSION_SECRET || '';
  let validCallback = false;
  try {
    const parsed = new URL(callbackUrl);
    validCallback = parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch {
    validCallback = false;
  }
  return {
    clientId,
    clientSecret,
    callbackUrl,
    sessionSecret,
    configured: Boolean(clientId && clientSecret && validCallback && sessionSecret.length >= 32 &&
      (process.env.VERCEL !== '1' || isBlobStorageConfigured())),
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function readCookie(req: express.Request, name: string): string | undefined {
  const cookieHeader = req.get('cookie') || '';
  for (const chunk of cookieHeader.split(';')) {
    const separator = chunk.indexOf('=');
    if (separator < 0) continue;
    if (chunk.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(chunk.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function cookieOptions(name: string, value: string, maxAge: number, path = '/'): string {
  const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function sendOAuthPopupResult(
  res: express.Response,
  callbackUrl: string,
  result: 'signed-in' | 'sign-in-failed',
  failureMessage?: string
): void {
  const origin = JSON.stringify(new URL(callbackUrl).origin);
  const resultValue = JSON.stringify(result);
  const messageValue = JSON.stringify(failureMessage || 'GitHub could not complete sign-in. Close this dialog and try again.');
  const fallback = result === 'signed-in' ? '/?github=signed-in' : '/?github=sign-in-failed';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.status(200).type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>GitHub sign-in</title><body><p>Sign-in complete. You can close this window.</p><script>
    const result = ${resultValue};
    if ('BroadcastChannel' in window) {
      const authChannel = new BroadcastChannel('acropin-auth');
      authChannel.postMessage({ type: 'acropin-github-oauth', result, message: ${messageValue} });
      authChannel.close();
      window.close();
    } else if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'acropin-github-oauth', result, message: ${messageValue} }, ${origin});
      window.close();
    } else {
      window.location.replace(${JSON.stringify(fallback)});
    }
  </script></body></html>`);
}

function makeSessionToken(profileId: string): string {
  const { sessionSecret } = getGitHubOAuthConfig();
  const payload = Buffer.from(JSON.stringify({ id: profileId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }))
    .toString('base64url');
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function getSessionContributor(req: express.Request): Promise<ContributorProfile | undefined> {
  const token = readCookie(req, SESSION_COOKIE);
  const { sessionSecret } = getGitHubOAuthConfig();
  if (!token || !sessionSecret) return undefined;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return undefined;
  const expected = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return undefined;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { id?: unknown; exp?: unknown };
    if (typeof session.id !== 'string' || typeof session.exp !== 'number' || session.exp <= Date.now() / 1000) {
      return undefined;
    }
    return await getContributorById(session.id);
  } catch {
    return undefined;
  }
}

function getRequestAccess(req: express.Request): RequestAccess | undefined {
  return requestAccess.get(req);
}

function publicContributor(profile: ContributorProfile) {
  return {
    id: profile.id,
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    profileUrl: profile.profileUrl,
    accessStatus: profile.accessStatus,
    contributionCount: profile.contributionCount,
    createdAt: profile.createdAt,
    lastLoginAt: profile.lastLoginAt,
  };
}

function isAllowedContributorRequest(req: express.Request): boolean {
  if (req.method === 'GET' && ['/dataset/targets', '/menu-tasks', '/canonical-dishes'].includes(req.path)) return true;
  if (req.method === 'GET' && req.path === '/images/catalog' && req.query.status === 'approved') return true;
  return req.method === 'POST' && [
    '/images/upload',
    '/images/process-url',
  ].includes(req.path);
}

function contributorDailyLimit(): number {
  const configured = Number.parseInt(process.env.GITHUB_CONTRIBUTOR_DAILY_LIMIT || '3', 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 20 ? configured : 3;
}

function isVisionVerified(inspection: PersistProcessedAssetInput['mlInspection']): boolean {
  return inspection.verificationLevel === 'vision-model' && inspection.antiCorruptionPassed;
}

function sourceFileExtension(format: string): string {
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg': return 'jpg';
    case 'png': return 'png';
    case 'webp': return 'webp';
    case 'avif': return 'avif';
    case 'tiff':
    case 'tif': return 'tiff';
    case 'heif':
    case 'heic': return 'heif';
    default: throw new Error(`Unsupported source image format: ${format}`);
  }
}

function sourceContentType(format: string): string {
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'tiff':
    case 'tif': return 'image/tiff';
    case 'heif':
    case 'heic': return 'image/heif';
    default: throw new Error(`Unsupported source image format: ${format}`);
  }
}

function onDemandImageUrl(assetId: string, maxEdge: number): string {
  return `/api/images/food-assets/${encodeURIComponent(assetId)}/v3/deliver?width=${maxEdge}&format=webp`;
}

function dimensionsWithinMaxEdge(sourceWidth: number, sourceHeight: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function isPlaceholderHostname(hostname: string): boolean {
  return ['example.com', 'example.org', 'example', 'localhost', 'local', 'test', 'invalid'].includes(hostname) ||
    ['.example.com', '.example.org', '.example', '.localhost', '.local', '.test', '.invalid']
      .some((suffix) => hostname.endsWith(suffix));
}

function decodeImageDataUrl(value: string): Buffer {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(value);
  if (!match) throw new Error('Image data must be a valid base64 image data URL.');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/u, '') !== match[1].replace(/=+$/u, '')) {
    throw new Error('Image data URL contains invalid base64 data.');
  }
  return buffer;
}

function resolveFoodName(dishName: unknown, requestedSlug?: unknown): ReturnType<typeof toUniversalFoodName> {
  if (typeof dishName !== 'string' || !dishName.trim()) {
    throw new Error('Provide the food dish name before processing this image.');
  }

  const normalized = toUniversalFoodName(dishName.trim());
  if (!normalized.universalName) {
    throw new Error('Dish name must include letters or numbers.');
  }

  if (typeof requestedSlug !== 'string' || !requestedSlug.trim()) return normalized;
  const slug = toUniversalFoodName(requestedSlug.trim());
  if (!slug.universalName) throw new Error('Universal dish name must include letters or numbers.');
  return { ...normalized, universalName: slug.universalName, filename: slug.filename };
}

async function persistProcessedAsset(input: PersistProcessedAssetInput): Promise<ImageAsset> {
  const assetId = `asset_${input.universalName}_${input.processed.hash.slice(0, 16)}_${randomUUID()}`;
  const storage = getStorageProvider();
  const sourceMaxEdge = Math.max(input.processed.sourceDimensions.width, input.processed.sourceDimensions.height);
  const thumbnailDimensions = dimensionsWithinMaxEdge(
    input.processed.sourceDimensions.width,
    input.processed.sourceDimensions.height,
    128
  );
  const variants = [
    { size: 480 as const, width: input.processed.width, height: input.processed.height },
    { size: 128 as const, ...thumbnailDimensions },
    ...(sourceMaxEdge >= 960
      ? [{ size: 960 as const, ...dimensionsWithinMaxEdge(input.processed.sourceDimensions.width, input.processed.sourceDimensions.height, 960) }]
      : []),
    ...(sourceMaxEdge >= 1600
      ? [{ size: 1600 as const, ...dimensionsWithinMaxEdge(input.processed.sourceDimensions.width, input.processed.sourceDimensions.height, 1600) }]
      : []),
  ];
  const uploaded: Array<{ key: string }> = [];

  try {
    const extension = sourceFileExtension(input.processed.sourceFormat);
    const source = await storage.upload(
      `food-assets/${assetId}/v3/source.${extension}`,
      input.sourceBuffer,
      sourceContentType(input.processed.sourceFormat)
    );
    uploaded.push(source);

    const now = new Date().toISOString();
    const variantSizes = variants.map(({ width, height }) => `${width}x${height}`);
    const dynamicUrl = (size: number) => onDemandImageUrl(assetId, size);
    const asset: ImageAsset = {
      id: assetId,
      canonicalDishId: input.canonicalDishId,
      storageKey: source.key,
      publicUrl: dynamicUrl(480),
      thumbnailUrl: dynamicUrl(128),
      thumbnailWidth: thumbnailDimensions.width,
      thumbnailHeight: thumbnailDimensions.height,
      retinaUrl: sourceMaxEdge >= 960 ? dynamicUrl(960) : undefined,
      retinaWidth: variants.find((variant) => variant.size === 960)?.width,
      retinaHeight: variants.find((variant) => variant.size === 960)?.height,
      hiResUrl: sourceMaxEdge >= 1600 ? dynamicUrl(1600) : undefined,
      hiResWidth: variants.find((variant) => variant.size === 1600)?.width,
      hiResHeight: variants.find((variant) => variant.size === 1600)?.height,
      sourceFormat: input.processed.sourceFormat,
      sourceWidth: input.processed.sourceDimensions.width,
      sourceHeight: input.processed.sourceDimensions.height,
      sha256Hash: input.processed.hash,
      perceptualHash: input.processed.perceptualHash,
      width: input.processed.width,
      height: input.processed.height,
      format: 'webp',
      originalByteSize: input.originalByteSize,
      byteSize: input.processed.byteSize,
      sourceUrl: input.rights.sourceUrl,
      sourceProvider: input.rights.sourceUrl ? new URL(input.rights.sourceUrl).hostname : 'Contributor upload',
      licenseType: input.rights.licenseType,
      licenseEvidence: input.rights.licenseEvidence,
      requiredAttribution: input.rights.requiredAttribution,
      rightsAttested: true,
      rightsAttestedAt: now,
      processingVersion: 'v3-on-demand',
      processingQuality: input.processed.qualityUsed,
      focalPoint: input.processed.focalPoint,
      approvalStatus: input.approvalStatus,
      createdAt: now,
      updatedAt: now,
      tags: [input.universalName, input.sourceTag],
      dishName: input.dishName,
      universalName: input.universalName,
      filename: input.filename,
      contributorGitHub: input.rights.contributorGitHub,
      contributorId: input.contributorId,
      mlInspection: input.mlInspection,
      acropinMetadata: {
        publisher: 'Acropin Open Food Library',
        universalName: input.universalName,
        cleanExif: true,
        schemaVersion: '2.0',
        variantsAvailable: variantSizes,
        license: input.rights.licenseType,
        contributorGitHub: input.rights.contributorGitHub,
        rightsAttested: true,
        mlVerified: isVisionVerified(input.mlInspection),
        timestamp: now,
      },
    };

    await registerAsset(asset);
    return asset;
  } catch (error) {
    await Promise.allSettled(uploaded.map(({ key }) => storage.delete(key)));
    throw error;
  }
}

function parseHttpsUrl(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(fieldName + ' is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(fieldName + ' must be a valid HTTPS URL.');
  }

  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || isPlaceholderHostname(host)) {
    throw new Error(fieldName + ' must be a real HTTPS URL, not an example or placeholder URL.');
  }
  return parsed.toString();
}

function normalizeRightsSubmission(
  body: Record<string, unknown>,
  inferredSourceUrl?: string
): RightsSubmission {
  const licenseType = body.licenseType;
  if (licenseType !== 'CC0' && licenseType !== 'CC-BY-4.0') {
    throw new Error('Choose CC0-1.0 or CC-BY-4.0 for this public library.');
  }

  if (body.rightsAttested !== true && body.rightsAttested !== 'true') {
    throw new Error('Confirm that you have the right to redistribute this image under the selected license.');
  }

  // External provenance links are not required in the contributor form.
  // Keep an explicit audit record of the contributor's rights attestation;
  // an actual image URL is still retained automatically when URL mode is used.
  const licenseEvidence = 'Contributor attestation: redistribution rights confirmed.';
  const submittedSourceUrl = typeof body.sourceUrl === 'string' && body.sourceUrl.trim()
    ? body.sourceUrl
    : inferredSourceUrl;
  const sourceUrl = submittedSourceUrl ? parseHttpsUrl(submittedSourceUrl, 'Image source URL') : undefined;

  if (sourceUrl) {
    const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
    if (DISALLOWED_IMAGE_HOSTS.some((host) => sourceHost === host || sourceHost.endsWith('.' + host))) {
      throw new Error('Stock-image sources are not accepted without a redistribution license specific to this library.');
    }
  }

  const attribution = typeof body.requiredAttribution === 'string'
    ? body.requiredAttribution.trim()
    : '';
  if (licenseType === 'CC-BY-4.0' && !attribution) {
    throw new Error('Attribution text is required for CC-BY-4.0 images.');
  }

  const contributorValue = typeof body.contributorGitHub === 'string'
    ? body.contributorGitHub.trim().replace(/^@/u, '')
    : '';
  if (contributorValue && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/u.test(contributorValue)) {
    throw new Error('GitHub username contains unsupported characters.');
  }

  return {
    licenseType,
    licenseEvidence,
    sourceUrl,
    requiredAttribution: attribution || undefined,
    contributorGitHub: contributorValue || undefined,
  };
}

app.use(express.json({ limit: vercelRequestLimit }));
app.use(express.urlencoded({ extended: true, limit: vercelRequestLimit }));

// The Vercel dashboard API is owner-only; restaurant apps use the
// approved-key Cloudflare image API for catalog access.
app.use('/api', async (req, res, next) => {
  try {
  if (req.path === '/auth/status' || req.path.startsWith('/auth/github')) {
    next();
    return;
  }

  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  const publicImageDelivery = ['GET', 'HEAD'].includes(req.method.toUpperCase())
    && req.originalUrl.split('?')[0].startsWith('/api/images/food-assets/');
  const publicApprovedCatalog = req.method.toUpperCase() === 'GET' &&
    req.path === '/images/catalog' && req.query.status === 'approved';
  const publicContributorLeaderboard = req.method.toUpperCase() === 'GET' &&
    req.path === '/contributors/leaderboard';

  // Approved image files are public. Catalog and menu metadata
  // are private to the owner here; restaurant apps use the approved-key
  // Cloudflare API instead.
  if (safeMethod && publicImageDelivery) {
    const expected = process.env.ADMIN_API_TOKEN;
    const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (expected && safeEqual(supplied, expected)) {
      requestAccess.set(req, { role: 'admin' });
    } else if (readCookie(req, SESSION_COOKIE)) {
      const profile = await getSessionContributor(req);
      if (isGitHubOwner(profile)) {
        requestAccess.set(req, { role: 'admin' });
      } else if (profile?.accessStatus === 'active') {
        requestAccess.set(req, { role: 'contributor', profile });
      }
    }
    next();
    return;
  }
  if (publicApprovedCatalog) {
    next();
    return;
  }
  if (publicContributorLeaderboard) {
    next();
    return;
  }

  const expected = process.env.ADMIN_API_TOKEN;
  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const adminAuthenticated = expected
    ? safeEqual(supplied, expected)
    : process.env.VERCEL !== '1';
  if (adminAuthenticated) {
    requestAccess.set(req, { role: 'admin' });
    next();
    return;
  }

  const profile = await getSessionContributor(req);
  if (isGitHubOwner(profile)) {
    requestAccess.set(req, { role: 'admin' });
    next();
    return;
  }
  if (profile?.accessStatus === 'active' && isAllowedContributorRequest(req)) {
    requestAccess.set(req, { role: 'contributor', profile });
    next();
    return;
  }

  if (profile?.accessStatus === 'blocked') {
    res.status(403).json({ error: 'Contributor access for this GitHub account is disabled. Contact the library owner.' });
    return;
  }
  if (!expected && process.env.VERCEL === '1') {
    res.status(503).json({ error: 'Admin access is not configured. Complete GitHub sign-in to use contributor access.' });
    return;
  }
  res.status(401).json({ error: 'Sign in with GitHub or enter the administrator access code.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/status', async (req, res, next) => {
  try {
  const expected = process.env.ADMIN_API_TOKEN;
  const required = Boolean(expected) || process.env.VERCEL === '1';
  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const validToken = Boolean(expected) && safeEqual(supplied, expected || '');
  const contributor = await getSessionContributor(req);
  const adminAuthenticated = validToken || isGitHubOwner(contributor) || !required;
  res.json({
    required,
    configured: Boolean(expected),
    authenticated: adminAuthenticated || contributor?.accessStatus === 'active',
    administrator: adminAuthenticated,
    githubConfigured: getGitHubOAuthConfig().configured,
    dailyContributionLimit: contributorDailyLimit(),
    contributor: contributor ? publicContributor(contributor) : null,
  });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/contributors', async (_req, res, next) => {
  try {
    res.json({ contributors: (await listContributors()).map(publicContributor) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/contributors/leaderboard', async (_req, res, next) => {
  try {
    await refreshCatalogFromStorage();
    const contributors = await listContributors();
    const leaderboard = buildMonthlyContributorLeaderboard(contributors, getAllAssets());
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    res.json(leaderboard);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/contributors/:id/access', async (req, res) => {
  const status = req.body?.status as ContributorAccessStatus;
  if (!['active', 'blocked'].includes(status)) {
    res.status(400).json({ error: 'Access status must be active or blocked.' });
    return;
  }
  const profile = await updateContributorAccess(req.params.id, status);
  if (!profile) {
    res.status(404).json({ error: 'Contributor profile not found.' });
    return;
  }
  await flushContributors();
  res.json({ contributor: publicContributor(profile) });
});

app.get('/api/auth/github', (_req, res) => {
  const config = getGitHubOAuthConfig();
  if (!config.configured) {
    res.status(503).send('GitHub sign-in is not configured for this deployment.');
    return;
  }
  const state = randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', cookieOptions(OAUTH_STATE_COOKIE, state, 600, '/api/auth/github'));
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', config.callbackUrl);
  authorize.searchParams.set('scope', 'read:user');
  authorize.searchParams.set('state', state);
  res.redirect(302, authorize.toString());
});

app.get('/api/auth/github/callback', async (req, res) => {
  const config = getGitHubOAuthConfig();
  const cookies = [cookieOptions(OAUTH_STATE_COOKIE, '', 0, '/api/auth/github')];
  if (!config.configured) {
    res.setHeader('Set-Cookie', cookies);
    res.status(503).send('GitHub sign-in is not configured for this deployment.');
    return;
  }
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const storedState = readCookie(req, OAUTH_STATE_COOKIE) || '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!state || !storedState || !safeEqual(state, storedState) || !code || req.query.error) {
    res.setHeader('Set-Cookie', cookies);
    sendOAuthPopupResult(res, config.callbackUrl, 'sign-in-failed');
    return;
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
      }),
    });
    if (!tokenResponse.ok) throw new Error('GitHub could not verify the sign-in code.');
    const tokenBody = await tokenResponse.json() as { access_token?: unknown; error?: unknown };
    if (typeof tokenBody.access_token !== 'string' || tokenBody.error) {
      const errorCode = typeof tokenBody.error === 'string' ? tokenBody.error : 'missing_access_token';
      throw new Error(`github_oauth_token_exchange:${errorCode}`);
    }
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenBody.access_token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Acropin-Food-Image-Library',
      },
    });
    if (!userResponse.ok) throw new Error('GitHub profile could not be loaded.');
    const user = await userResponse.json() as {
      id?: unknown;
      login?: unknown;
      name?: unknown;
      avatar_url?: unknown;
      html_url?: unknown;
    };
    const githubId = String(user.id ?? '');
    const login = typeof user.login === 'string' ? user.login : '';
    if (!/^\d+$/u.test(githubId) || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/u.test(login) ||
        typeof user.avatar_url !== 'string' || typeof user.html_url !== 'string' ||
        !user.avatar_url.startsWith('https://') || !user.html_url.startsWith('https://')) {
      throw new Error('GitHub returned a profile with an unexpected format.');
    }

    const profile = await upsertGitHubContributor({
      githubId,
      login,
      name: typeof user.name === 'string' ? user.name : undefined,
      avatarUrl: user.avatar_url,
      profileUrl: user.html_url,
    });
    await flushContributors();
    cookies.push(cookieOptions(SESSION_COOKIE, makeSessionToken(profile.id), SESSION_TTL_SECONDS));
    res.setHeader('Set-Cookie', cookies);
    // OAuth sign-in establishes contributor access immediately. Accounts that
    // were explicitly blocked remain blocked and the client displays that state.
    sendOAuthPopupResult(res, config.callbackUrl, 'signed-in');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.error('GitHub OAuth callback failed:', errorMessage);
    const failureMessage = errorMessage.includes('incorrect_client_credentials')
      ? 'GitHub rejected the OAuth app credentials. The owner must replace GITHUB_OAUTH_CLIENT_SECRET in Vercel with a newly generated secret from this GitHub OAuth App.'
      : errorMessage.includes('redirect_uri_mismatch')
        ? 'GitHub rejected the callback URL. It must be https://acropin-sharpvips.vercel.app/api/auth/github/callback in both Vercel and the GitHub OAuth App.'
        : errorMessage.includes('bad_verification_code')
          ? 'This sign-in attempt expired or was already used. Close the popup and start a fresh GitHub sign-in.'
          : 'GitHub could not complete sign-in. Check the Vercel function logs for the safe OAuth error code, then try again.';
    res.setHeader('Set-Cookie', cookies);
    sendOAuthPopupResult(res, config.callbackUrl, 'sign-in-failed', failureMessage);
  }
});

app.post('/api/auth/github/logout', (req, res) => {
  res.setHeader('Set-Cookie', cookieOptions(SESSION_COOKIE, '', 0));
  res.json({ success: true });
});

// Configure Multer for memory storage upload handling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // Vercel Functions reject request bodies larger than 4.5 MB before the
    // request reaches Express, so leave room for multipart overhead.
    fileSize: process.env.VERCEL === '1' ? 3.5 * 1024 * 1024 : 15 * 1024 * 1024,
  },
});

// Initialize Stores
await initializeCatalog();
await initializeRestaurants();
await initializeTargetDataset();
await initializeContributors();

// Approved assets are public; pending assets can be previewed by their owner or an admin.
app.get('/api/images/food-assets/*', async (req, res) => {
  try {
    // A different Vercel function instance may have accepted this upload, so
    // refresh shared metadata before resolving the image or its visibility.
    await refreshCatalogFromStorage();
    const relPath = (req.params as Record<string, string>)[0];
    const key = `food-assets/${relPath}`;

    const deliveryMatch = /^([^/]+)\/v3\/deliver$/u.exec(relPath);
    if (deliveryMatch) {
      const assetId = deliveryMatch[1];
      const asset = getAllAssets().find((candidate) =>
        candidate.id === assetId && candidate.processingVersion === 'v3-on-demand'
      );
      if (!asset || !canReadImageAsset(asset.approvalStatus, asset.contributorId, getRequestAccess(req))) {
        res.status(404).json({ error: 'Approved image asset not found.' });
        return;
      }

      const widthText = typeof req.query.width === 'string' ? req.query.width : '480';
      const heightText = typeof req.query.height === 'string' ? req.query.height : widthText;
      const width = Number(widthText);
      const height = Number(heightText);
      if (!/^\d{1,4}$/u.test(widthText) || !/^\d{1,4}$/u.test(heightText) ||
          !Number.isInteger(width) || !Number.isInteger(height) ||
          width < 32 || height < 32 || width > 1600 || height > 1600) {
        res.status(400).json({ error: 'Image width and height must be whole numbers from 32 to 1600 pixels.' });
        return;
      }

      const requestedFormat = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'webp';
      const acceptedFormats = new Set(['auto', 'webp', 'avif', 'jpeg', 'png']);
      if (!acceptedFormats.has(requestedFormat)) {
        res.status(400).json({ error: 'Image format must be auto, webp, avif, jpeg, or png.' });
        return;
      }
      const accept = req.get('accept') ?? '';
      const outputFormat = requestedFormat === 'auto'
        ? accept.includes('image/avif') ? 'avif'
          : accept.includes('image/webp') ? 'webp'
            : 'jpeg'
        : requestedFormat;

      const storage = getStorageProvider();
      const source = await storage.get(asset.storageKey);
      if (!source) {
        res.status(404).json({ error: 'Stored source image is missing.' });
        return;
      }

      const pipeline = sharp(source.data, { failOn: 'error', limitInputPixels: 30_000_000 })
        .rotate()
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3,
        })
        .toColorspace('srgb');
      const encoded = outputFormat === 'avif'
        ? await pipeline.avif({ quality: 95, effort: 6 }).toBuffer({ resolveWithObject: true })
        : outputFormat === 'jpeg'
          ? await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 95, mozjpeg: true }).toBuffer({ resolveWithObject: true })
          : outputFormat === 'png'
            ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
            : await pipeline.webp({ quality: 95, effort: 6, smartSubsample: true }).toBuffer({ resolveWithObject: true });

      res.setHeader('Content-Type', `image/${outputFormat === 'jpeg' ? 'jpeg' : outputFormat}`);
      res.setHeader('Content-Length', String(encoded.data.length));
      res.setHeader('X-Image-Width', String(encoded.info.width));
      res.setHeader('X-Image-Height', String(encoded.info.height));
      res.setHeader('X-Image-Source-Format', asset.sourceFormat ?? 'unknown');
      res.setHeader('Cache-Control', asset.approvalStatus === 'approved'
        ? 'public, max-age=300, s-maxage=300, stale-while-revalidate=60'
        : 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (requestedFormat === 'auto') res.setHeader('Vary', 'Accept');
      res.send(encoded.data);
      return;
    }

    const asset = getAllAssets().find((candidate) => [
      ...(candidate.processingVersion === 'v3-on-demand' ? [] : [candidate.storageKey]),
      candidate.thumbnailStorageKey,
      candidate.retinaStorageKey,
      candidate.hiResStorageKey,
    ].includes(key));

    if (!asset || !canReadImageAsset(asset.approvalStatus, asset.contributorId, getRequestAccess(req))) {
      res.status(404).json({ error: 'Approved image asset not found.' });
      return;
    }

    const storage = getStorageProvider();
    const item = await storage.get(key);
    if (!item) {
      res.status(404).json({ error: 'Image asset not found.' });
      return;
    }

    res.setHeader('Content-Type', item.contentType || 'image/webp');
    res.setHeader('Cache-Control', asset.approvalStatus === 'approved'
      ? 'public, max-age=300, s-maxage=300'
      : 'private, no-store');
    res.send(item.data);
  } catch (err) {
    console.error('Image asset delivery failed:', err);
    res.status(503).json({ error: 'Could not refresh or retrieve the image asset.' });
  }
});

// -------------------------------------------------------------
// Image Processing & Catalog API
// -------------------------------------------------------------

// List assets with filtering
app.get('/api/images/catalog', (req, res) => {
  const status = req.query.status as AssetApprovalStatus | undefined;
  const search = req.query.search as string | undefined;
  const dishId = req.query.dishId as string | undefined;

  const assets = getAllAssets({ status, search, dishId });
  res.json({ assets, total: assets.length });
});

// Delete an asset from collection
app.delete('/api/images/collection/:id', async (req, res) => {
  try {
    if (isPackageAsset(req.params.id)) {
      res.status(409).json({ error: 'This image is part of the published npm package. Remove it through a reviewed GitHub contribution pull request.' });
      return;
    }
    const removedAsset = getAssetById(req.params.id);
    const success = await deleteAsset(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Asset not found in collection.' });
      return;
    }
    if (removedAsset) await releaseDishContributionLock(removedAsset.universalName);
    res.json({ success: true, message: 'Asset deleted from library.' });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Upload and process an image with dual resolution & ML anti-corruption filter
app.post('/api/images/upload', upload.single('image'), async (req, res) => {
  let lockedSlug: string | undefined;
  let lockReservationId: string | undefined;
  let keepLock = false;
  let dailySlot: ContributorDailySlot | undefined;
  let keepDailySlot = false;
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No image file uploaded.' });
      return;
    }

    const {
      dishName,
      universalName: clientUniversalName,
      canonicalDishId,
    } = req.body;
    if (typeof dishName !== 'string' || !dishName.trim()) {
      res.status(400).json({ error: 'Provide the food dish name before processing this image.' });
      return;
    }
    const universal = resolveFoodName(dishName, clientUniversalName);
    const access = getRequestAccess(req);
    const rights = normalizeRightsSubmission(req.body as Record<string, unknown>);
    if (access?.role === 'contributor') rights.contributorGitHub = access.profile.login;

    await refreshCatalogFromStorage();
    const existingDish = findBlockingAssetBySlug(universal.universalName);
    if (existingDish) {
      res.status(409).json({
        error: `“${existingDish.dishName}” already has a ${existingDish.approvalStatus.replace('_', ' ')} image. Duplicate dish contributions are locked.`,
        duplicateAssetId: existingDish.id,
        approvalStatus: existingDish.approvalStatus,
      });
      return;
    }
    lockReservationId = randomUUID();
    await acquireDishContributionLock(universal.universalName, lockReservationId, async () => {
      await refreshCatalogFromStorage();
      return Boolean(findBlockingAssetBySlug(universal.universalName));
    });
    lockedSlug = universal.universalName;
    if (access?.role === 'contributor') {
      dailySlot = await acquireContributorDailySlot(access.profile.id, randomUUID(), contributorDailyLimit());
    }

    // Create full-frame variants with a 480px maximum edge and high WebP quality.
    const processed = await processFoodImage(req.file.buffer, {
      width: 480,
      height: 480,
      initialQuality: 95,
      effort: 6,
      generateHierarchy: false,
    });

    // Derive a stable universal dish slug; each image receives its own immutable asset ID.
    const duplicateAsset = findAssetByHash(processed.hash);
    if (duplicateAsset) {
      res.status(409).json({
        error: 'This exact processed image already exists in the library.',
        duplicateAssetId: duplicateAsset.id,
        approvalStatus: duplicateAsset.approvalStatus,
      });
      return;
    }

    const similarAsset = await findSimilarAssetByPerceptualHash(processed.perceptualHash);
    if (similarAsset) {
      res.status(409).json({
        error: `This image is a near-duplicate of “${similarAsset.asset.dishName}” in the library (${similarAsset.distance}/${64} perceptual hash bits differ).`,
        duplicateAssetId: similarAsset.asset.id,
        approvalStatus: similarAsset.asset.approvalStatus,
        similarity: {
          algorithm: 'dct-phash-64',
          hammingDistance: similarAsset.distance,
          maximumAcceptedDistance: MAX_PERCEPTUAL_DUPLICATE_DISTANCE,
        },
      });
      return;
    }

    // Use a vision model when configured; otherwise only structural checks run.
    const mlInspection = await inspectFoodImageWithMl(
      processed.buffer,
      universal.displayName,
      universal.universalName
    );

    // Strict Enforcement: Deny and refuse dataset corruption/non-food
    if (!mlInspection.antiCorruptionPassed) {
      res.status(422).json({
        error: `Image inspection denied this upload: ${mlInspection.rejectionReason || 'The image failed structural checks.'}`,
        mlInspection,
        denied: true,
      });
      return;
    }

    const isDirectApproved = access?.role === 'admin' &&
      (req.body.adminAutoApprove === 'true' || req.body.submitDirect === 'true');
    const approvalStatus: AssetApprovalStatus = isDirectApproved ? 'approved' : 'pending_review';
    const validCanonicalDishId = CANONICAL_DISHES.some((dish) => dish.id === canonicalDishId)
      ? canonicalDishId
      : undefined;
    const asset = await persistProcessedAsset({
      processed,
      sourceBuffer: req.file.buffer,
      dishName: universal.displayName,
      universalName: universal.universalName,
      filename: universal.filename,
      canonicalDishId: validCanonicalDishId,
      originalByteSize: req.file.buffer.length,
      rights,
      mlInspection,
      approvalStatus,
      sourceTag: rights.sourceUrl ? 'source-url' : 'contributor-upload',
      contributorId: access?.role === 'contributor' ? access.profile.id : undefined,
    });
    keepLock = true;
    await commitDishContributionLock(universal.universalName, lockReservationId)
      .catch((error) => console.error('Could not mark the saved dish reservation as committed:', error));
    if (access?.role === 'contributor') {
      keepDailySlot = true;
      if (dailySlot) await commitContributorDailySlot(dailySlot)
        .catch((error) => console.error('Could not mark the contributor quota slot as committed:', error));
      recordContributorSubmission(access.profile.id);
      await flushContributors().catch((error) => console.error('Could not update contributor submission count:', error));
    }
    const match = matchCanonicalDish(universal.displayName);

    res.status(201).json({
      asset,
      canonicalMatch: match,
      warning: processed.sizeDeviationWarning,
      sourceDimensions: processed.sourceDimensions,
      mlInspection,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err instanceof ContributorDailyLimitError ? 429
      : err instanceof DuplicateAssetError || err instanceof DishContributionLockedError ? 409
      : err instanceof StorageError || err instanceof PerceptualIndexUnavailableError || err instanceof DishContributionLockUnavailableError ? 503 : 400)
      .json({ error: message });
  } finally {
    if (dailySlot && !keepDailySlot) {
      await releaseContributorDailySlot(dailySlot).catch((error) => {
        console.error('Could not release an unfinished contributor quota slot:', error);
      });
    }
    if (lockedSlug && !keepLock) {
      await releaseDishContributionLock(lockedSlug, lockReservationId).catch((error) => {
        console.error('Could not release an unfinished dish reservation:', error);
      });
    }
  }
});

// Process an image from a public HTTPS URL with dual resolution and optional vision inspection.
app.post('/api/images/process-url', async (req, res) => {
  let lockedSlug: string | undefined;
  let lockReservationId: string | undefined;
  let keepLock = false;
  let dailySlot: ContributorDailySlot | undefined;
  let keepDailySlot = false;
  try {
    const {
      imageUrl,
      dishName,
      universalName: clientUniversalName,
      canonicalDishId,
    } = req.body;

    if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
      res.status(400).json({ error: 'Provide an image URL or data image.' });
      return;
    }
    const targetName = typeof dishName === 'string' ? dishName.trim() : '';
    if (!targetName) {
      res.status(400).json({ error: 'Provide the food dish name before processing this image.' });
      return;
    }
    const universal = resolveFoodName(targetName, clientUniversalName);
    const access = getRequestAccess(req);
    const rights = normalizeRightsSubmission(
      req.body as Record<string, unknown>,
      imageUrl.startsWith('data:') ? undefined : imageUrl
    );
    if (access?.role === 'contributor') rights.contributorGitHub = access.profile.login;
    await refreshCatalogFromStorage();
    const existingDish = findBlockingAssetBySlug(universal.universalName);
    if (existingDish) {
      res.status(409).json({
        error: `“${existingDish.dishName}” already has a ${existingDish.approvalStatus.replace('_', ' ')} image. Duplicate dish contributions are locked.`,
        duplicateAssetId: existingDish.id,
        approvalStatus: existingDish.approvalStatus,
      });
      return;
    }
    lockReservationId = randomUUID();
    await acquireDishContributionLock(universal.universalName, lockReservationId, async () => {
      await refreshCatalogFromStorage();
      return Boolean(findBlockingAssetBySlug(universal.universalName));
    });
    lockedSlug = universal.universalName;
    if (access?.role === 'contributor') {
      dailySlot = await acquireContributorDailySlot(access.profile.id, randomUUID(), contributorDailyLimit());
    }

    let buffer: Buffer;

    if (imageUrl.startsWith('data:')) {
      buffer = decodeImageDataUrl(imageUrl);
    } else {
      buffer = await fetchRemoteImage(imageUrl);
    }

    if (buffer.length > 15 * 1024 * 1024) {
      res.status(400).json({ error: 'Fetched image exceeds 15 MB limit.' });
      return;
    }

    // Create full-frame variants with a 480px maximum edge and high WebP quality.
    const processed = await processFoodImage(buffer, {
      width: 480,
      height: 480,
      initialQuality: 95,
      effort: 6,
      generateHierarchy: false,
    });


    const duplicateAsset = findAssetByHash(processed.hash);
    if (duplicateAsset) {
      res.status(409).json({
        error: 'This exact processed image already exists in the library.',
        duplicateAssetId: duplicateAsset.id,
        approvalStatus: duplicateAsset.approvalStatus,
      });
      return;
    }

    const similarAsset = await findSimilarAssetByPerceptualHash(processed.perceptualHash);
    if (similarAsset) {
      res.status(409).json({
        error: `This image is a near-duplicate of “${similarAsset.asset.dishName}” in the library (${similarAsset.distance}/64 perceptual hash bits differ).`,
        duplicateAssetId: similarAsset.asset.id,
        approvalStatus: similarAsset.asset.approvalStatus,
        similarity: {
          algorithm: 'dct-phash-64',
          hammingDistance: similarAsset.distance,
          maximumAcceptedDistance: MAX_PERCEPTUAL_DUPLICATE_DISTANCE,
        },
      });
      return;
    }

    // Use a vision model when configured; otherwise only structural checks run.
    const mlInspection = await inspectFoodImageWithMl(
      processed.buffer,
      universal.displayName,
      universal.universalName
    );

    // Strict Enforcement: Deny and refuse dataset corruption/non-food
    if (!mlInspection.antiCorruptionPassed) {
      res.status(422).json({
        error: `Image inspection denied this upload: ${mlInspection.rejectionReason || 'The image failed structural checks.'}`,
        mlInspection,
        denied: true,
      });
      return;
    }

    const isDirectApproved = access?.role === 'admin' &&
      (req.body.adminAutoApprove === 'true' || req.body.submitDirect === 'true');
    const approvalStatus: AssetApprovalStatus = isDirectApproved ? 'approved' : 'pending_review';
    const validCanonicalDishId = CANONICAL_DISHES.some((dish) => dish.id === canonicalDishId)
      ? canonicalDishId
      : undefined;
    const asset = await persistProcessedAsset({
      processed,
      sourceBuffer: buffer,
      dishName: universal.displayName,
      universalName: universal.universalName,
      filename: universal.filename,
      canonicalDishId: validCanonicalDishId,
      originalByteSize: buffer.length,
      rights,
      mlInspection,
      approvalStatus,
      sourceTag: rights.sourceUrl ? 'source-url' : 'contributor-upload',
      contributorId: access?.role === 'contributor' ? access.profile.id : undefined,
    });
    keepLock = true;
    await commitDishContributionLock(universal.universalName, lockReservationId)
      .catch((error) => console.error('Could not mark the saved dish reservation as committed:', error));
    if (access?.role === 'contributor') {
      keepDailySlot = true;
      if (dailySlot) await commitContributorDailySlot(dailySlot)
        .catch((error) => console.error('Could not mark the contributor quota slot as committed:', error));
      recordContributorSubmission(access.profile.id);
      await flushContributors().catch((error) => console.error('Could not update contributor submission count:', error));
    }
    const match = matchCanonicalDish(universal.displayName);

    res.status(201).json({
      asset,
      canonicalMatch: match,
      warning: processed.sizeDeviationWarning,
      sourceDimensions: processed.sourceDimensions,
      mlInspection,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err instanceof ContributorDailyLimitError ? 429
      : err instanceof DuplicateAssetError || err instanceof DishContributionLockedError ? 409
      : err instanceof StorageError || err instanceof PerceptualIndexUnavailableError || err instanceof DishContributionLockUnavailableError ? 503 : 400)
      .json({ error: message });
  } finally {
    if (dailySlot && !keepDailySlot) {
      await releaseContributorDailySlot(dailySlot).catch((error) => {
        console.error('Could not release an unfinished contributor quota slot:', error);
      });
    }
    if (lockedSlug && !keepLock) {
      await releaseDishContributionLock(lockedSlug, lockReservationId).catch((error) => {
        console.error('Could not release an unfinished dish reservation:', error);
      });
    }
  }
});

// Real-time pre-upload ML inspection endpoint
app.post('/api/ml/inspect', upload.single('image'), async (req, res) => {
  try {
    const dishName = typeof req.body.dishName === 'string' ? req.body.dishName.trim() : '';
    const targetSlug = req.body.universalSlug || '';
    if (!dishName) {
      res.status(400).json({ error: 'Dish name is required for image inspection.' });
      return;
    }
    let buffer: Buffer | null = req.file?.buffer || null;

    if (!buffer && req.body.imageUrl) {
      const url = req.body.imageUrl;
      if (url.startsWith('data:')) {
        buffer = decodeImageDataUrl(url);
      } else if (url.startsWith('https://')) {
        buffer = await fetchRemoteImage(url);
      }
    }

    if (!buffer) {
      res.status(400).json({ error: 'Provide an image file or valid imageUrl for ML inspection.' });
      return;
    }

    const inspection = await inspectFoodImageWithMl(buffer, dishName, targetSlug);
    res.json({ mlInspection: inspection });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Real-time Excel-like Inventory Dashboard: live missing vs completed dishes
app.get('/api/menu-tasks', async (_req, res) => {
  try {
    const status = await withFreshTargetDataset(() => {
      const approved = getAllAssets({ status: 'approved' });
      const pending = getAllAssets({ status: 'pending_review' });
      return computeDatasetStatus(approved, pending);
    });
    res.json(status);
  } catch (err: unknown) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'Could not refresh the shared menu inventory.' });
  }
});

// Live Target Dataset & Excel Spreadsheet Endpoint
app.get('/api/dataset/targets', async (_req, res) => {
  try {
    const status = await withFreshTargetDataset(() => {
      const approved = getAllAssets({ status: 'approved' });
      const pending = getAllAssets({ status: 'pending_review' });
      return computeDatasetStatus(approved, pending);
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(status);
  } catch (err: unknown) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'Could not refresh the shared menu inventory.' });
  }
});

// Bulk Import or Paste Excel/CSV Menu Data into Database
app.post('/api/dataset/targets/import', async (req, res) => {
  try {
    const { items, rawText, replaceExisting } = req.body;
    if (replaceExisting !== undefined && typeof replaceExisting !== 'boolean') {
      res.status(400).json({ error: 'replaceExisting must be true or false.' });
      return;
    }
    const listToImport = Array.isArray(items)
      ? items as Array<{ sourceId?: string; name: string; category: string; dietary: string; region?: string; notes?: string }>
      : typeof rawText === 'string'
        ? parseDatasetTargetImport(rawText)
        : [];

    const { result, datasetStatus } = await withFreshTargetDataset(async () => {
      const result = bulkImportTargets(listToImport, replaceExisting === true);
      await flushTargets();
      const approved = getAllAssets({ status: 'approved' });
      const pending = getAllAssets({ status: 'pending_review' });
      return { result, datasetStatus: computeDatasetStatus(approved, pending) };
    });

    res.json({
      success: true,
      imported: result.added,
      totalTargets: result.total,
      datasetStatus,
    });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Add Single Target Dish
app.post('/api/dataset/targets/add', async (req, res) => {
  try {
    const { name, category, dietary, region, notes } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Dish name is required.' });
      return;
    }
    if (typeof category !== 'string' || !category.trim()) {
      res.status(400).json({ error: 'Dish category is required.' });
      return;
    }
    if (!['veg', 'non-veg', 'vegan'].includes(dietary)) {
      res.status(400).json({ error: 'Choose a dietary value: veg, non-veg, or vegan.' });
      return;
    }
    const item = await withFreshTargetDataset(async () => {
      const addedItem = addTargetItem(name, category, dietary, region, notes);
      await flushTargets();
      return addedItem;
    });
    res.status(201).json({ success: true, item });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete a Target Item
app.delete('/api/dataset/targets/:id', async (req, res) => {
  try {
    const success = await withFreshTargetDataset(async () => {
      const deleted = deleteTargetItem(req.params.id);
      await flushTargets();
      return deleted;
    });
    if (!success) {
      res.status(404).json({ error: 'Target item not found in dataset.' });
      return;
    }
    res.json({ success: true, message: 'Target item deleted.' });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Export Real-time Inventory as CSV
app.get('/api/dataset/export-csv', async (_req, res) => {
  try {
    const csv = await withFreshTargetDataset(() => {
      const approved = getAllAssets({ status: 'approved' });
      const pending = getAllAssets({ status: 'pending_review' });
      const status = computeDatasetStatus(approved, pending);
      const header = ['Universal Slug', 'Dish Name', 'Category', 'Dietary', 'Status', '128px URL', '480px URL', '960px URL', '1600px URL', 'Size (KB)', 'Clean EXIF', 'ML Verified'];
      const rows = status.rows.map((r) => [
        `"${r.universalSlug}"`,
        `"${r.name.replace(/"/g, '""')}"`,
        `"${r.category.replace(/"/g, '""')}"`,
        `"${r.dietary}"`,
        `"${r.status}"`,
        `"${r.asset?.thumbnailUrl || ''}"`,
        `"${r.asset?.publicUrl || ''}"`,
        `"${r.asset?.retinaUrl || ''}"`,
        `"${r.asset?.hiResUrl || ''}"`,
        r.fileSizeKb,
        r.metadataTags?.cleanExif ? 'YES' : 'NO',
        r.metadataTags?.mlVerified ? 'YES' : 'NO',
      ]);
      return [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="acropin-food-inventory.csv"');
    res.send(csv);
  } catch (err: unknown) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'Could not refresh the shared menu inventory.' });
  }
});

// Organizer Review Queue List
app.get('/api/images/review-queue', (_req, res) => {
  const pending = getAllAssets({ status: 'pending_review' });
  res.json({ pending, count: pending.length });
});

// Organizer Review Decision (Approve / Reject)
app.post('/api/images/review-queue/:id/decision', async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason } = req.body;
    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ error: 'Decision must be "approve" or "reject".' });
      return;
    }

    const newStatus: AssetApprovalStatus = decision === 'approve' ? 'approved' : 'rejected';
    const updated = updateAssetStatus(id, newStatus, rejectionReason);
    if (!updated) {
      res.status(404).json({ error: 'Asset not found in review queue.' });
      return;
    }

    await flushCatalog();
    if (decision === 'reject') await releaseDishContributionLock(updated.universalName);
    const approved = getAllAssets({ status: 'approved' });
    const pending = getAllAssets({ status: 'pending_review' });
    const datasetStatus = computeDatasetStatus(approved, pending);

    res.json({
      success: true,
      asset: updated,
      datasetStatus,
      message: decision === 'approve' ? 'Approved and committed to live database.' : 'Submission rejected.',
    });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update asset approval status (e.g. approved, rejected, revoked)
app.patch('/api/images/catalog/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (!['approved', 'pending_review', 'rejected', 'revoked'].includes(status)) {
    res.status(400).json({ error: 'Invalid approval status provided.' });
    return;
  }

  const updated = updateAssetStatus(id, status as AssetApprovalStatus, reason);
  if (!updated) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  let revocationReport;
  if (status === 'revoked') {
    revocationReport = handleAssetRevocation(id);
    await flushRestaurantStore();
  }
  await flushCatalog();
  if (status === 'rejected') await releaseDishContributionLock(updated.universalName);

  res.json({
    asset: updated,
    revocationReport,
  });
});

// -------------------------------------------------------------
// Canonical Dishes API
// -------------------------------------------------------------
app.get('/api/canonical-dishes', (_req, res) => {
  res.json({ dishes: CANONICAL_DISHES });
});

// -------------------------------------------------------------
// Restaurant Tenants & Menus API
// -------------------------------------------------------------
app.get('/api/restaurants', (_req, res) => {
  const list = getAllRestaurants();
  res.json({ restaurants: list });
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const menu = getRestaurantMenu(req.params.id);
  if (!menu) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }
  res.json({ menu });
});

// Preview menu import
app.post('/api/restaurants/:id/import-preview', (req, res) => {
  try {
    const { menuJson } = req.body;
    const preview = generateImportPreview(req.params.id, menuJson);
    res.json(preview);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Commit menu import transaction
app.post('/api/restaurants/:id/import-commit', async (req, res) => {
  try {
    const { previewItems, userOverrides, actor } = req.body;
    const result = commitMenuImport(req.params.id, previewItems, userOverrides || {}, actor);
    await flushRestaurantStore();
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update single item image assignment manually
app.patch('/api/restaurants/:id/assignments/:itemId', async (req, res) => {
  try {
    const { assetId, actor } = req.body;
    const item = updateMenuItemAssignment(req.params.id, req.params.itemId, assetId, actor);
    if (!item) {
      res.status(404).json({ error: 'Menu item or restaurant not found.' });
      return;
    }
    await flushRestaurantStore();
    res.json({ item });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Strict API 404 handler so any unmatched /api call returns JSON, never HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// Global API error handler
app.use('/api', (err: any, _req: any, res: any, _next: any) => {
  const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({ error: err.message || 'Internal API error' });
});

// -------------------------------------------------------------
// Vite Dev Server / Static File Serving
// -------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  const setNoStoreHtmlHeaders = (res: express.Response): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  app.use(express.static(path.resolve(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (path.extname(filePath).toLowerCase() === '.html') {
        setNoStoreHtmlHeaders(res);
      }
    },
  }));
  app.get('*', (_req, res) => {
    setNoStoreHtmlHeaders(res);
    res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

if (process.env.VERCEL !== '1') {
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Acropin Server listening on http://0.0.0.0:${port}`);
  });
}

export default app;
