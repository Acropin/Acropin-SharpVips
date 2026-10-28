/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  FOOD_ASSETS: R2Bucket;
  API_RATE_LIMITER: DurableObjectNamespace;
  OWNER_API_KEY: string;
  IMAGE_URL_SECRET: string;
  ACCESS_CONTACT_URL: string;
}

interface ApiKeyRow {
  id: string;
  label: string;
  requests_per_minute: number;
  requests_per_day: number;
}

interface ImageVariant {
  objectKey: string;
  width: number;
  height: number;
  byteSize: number;
  format: 'webp';
}

interface FoodImageRow {
  slug: string;
  dish_name: string;
  canonical_dish_id: string | null;
  category: string;
  creator: string;
  tags_json: string;
  license: string;
  attribution: string | null;
  source_url: string | null;
  license_evidence_url: string | null;
  variants_json: string;
}

interface AuthenticatedClient {
  id: string;
  label: string;
  owner: boolean;
  requestsPerMinute: number;
  requestsPerDay: number;
}

const DEFAULT_REQUESTS_PER_MINUTE = 120;
const DEFAULT_REQUESTS_PER_DAY = 5_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_URL_TTL_SECONDS = 15 * 60;
const VARIANT_SIZES = new Set(['480', '960', '1600']);

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length > 512 || b.length > 512) return false;

  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function randomToken(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function authenticate(request: Request, env: Env): Promise<AuthenticatedClient | null> {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  const token = match?.[1]?.trim() ?? '';
  if (!token || token.length > 256) return null;

  if (env.OWNER_API_KEY && constantTimeEqual(token, env.OWNER_API_KEY)) {
    return {
      id: 'owner',
      label: 'Acropin owner',
      owner: true,
      requestsPerMinute: Number.MAX_SAFE_INTEGER,
      requestsPerDay: Number.MAX_SAFE_INTEGER,
    };
  }

  const keyHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT id, label, requests_per_minute, requests_per_day FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1'
  ).bind(keyHash).first<ApiKeyRow>();
  if (!row) return null;

  return {
    id: row.id,
    label: row.label,
    owner: false,
    requestsPerMinute: row.requests_per_minute,
    requestsPerDay: row.requests_per_day,
  };
}

async function enforceCustomerLimit(client: AuthenticatedClient, env: Env): Promise<Response | null> {
  if (client.owner) return null;

  const objectId = env.API_RATE_LIMITER.idFromName(client.id);
  const limiter = env.API_RATE_LIMITER.get(objectId);
  const decisionResponse = await limiter.fetch('https://rate-limiter/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestsPerMinute: client.requestsPerMinute,
      requestsPerDay: client.requestsPerDay,
      now: Date.now(),
    }),
  });
  const decision = await decisionResponse.json<{
    allowed: boolean;
    remainingMinute: number;
    remainingDay: number;
    retryAfter: number;
  }>();

  if (!decision.allowed) {
    return json(
      {
        error: 'API request limit reached.',
        retryAfterSeconds: decision.retryAfter,
        contact: env.ACCESS_CONTACT_URL,
      },
      429,
      {
        'Retry-After': String(decision.retryAfter),
        'X-RateLimit-Limit-Minute': String(client.requestsPerMinute),
        'X-RateLimit-Remaining-Minute': String(decision.remainingMinute),
        'X-RateLimit-Remaining-Day': String(decision.remainingDay),
      }
    );
  }
  return null;
}

async function importImageSigningKey(env: Env, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.IMAGE_URL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

async function signImageUrls(
  signingKey: CryptoKey,
  clientId: string,
  slug: string,
  sizes: string[],
  origin: string
): Promise<Record<string, string>> {
  const expires = Math.floor(Date.now() / 1000) + IMAGE_URL_TTL_SECONDS;
  const payload = `${clientId}\n${slug}\n${expires}`;
  const signature = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(payload));
  const signatureText = toBase64Url(new Uint8Array(signature));
  return Object.fromEntries(sizes.map((size) => {
    const signedPath = `/api/v1/images/${encodeURIComponent(slug)}/${size}.webp?client=${encodeURIComponent(clientId)}&exp=${expires}&sig=${signatureText}`;
    return [size, new URL(signedPath, origin).toString()];
  }));
}

async function verifyImageUrl(
  env: Env,
  clientId: string,
  slug: string,
  expires: number,
  signatureText: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + IMAGE_URL_TTL_SECONDS + 30) return false;
  if (!/^[A-Za-z0-9_-]{32,64}$/u.test(signatureText)) return false;

  const payload = `${clientId}\n${slug}\n${expires}`;
  const hmacKey = await importImageSigningKey(env, 'verify');
  const normalized = signatureText.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let signature: Uint8Array;
  try {
    signature = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', hmacKey, signature as BufferSource, new TextEncoder().encode(payload));
}

function parseVariants(row: FoodImageRow): Record<string, ImageVariant> {
  try {
    const parsed = JSON.parse(row.variants_json) as Record<string, ImageVariant>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function slugIsValid(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) && slug.length <= 64;
}

async function handleCatalogRequest(request: Request, env: Env, client: AuthenticatedClient): Promise<Response> {
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 100).toLowerCase();
  const category = (url.searchParams.get('category') ?? '').trim().slice(0, 80).toLowerCase();
  const limit = Math.max(1, Math.min(50, Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24));
  const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0));
  const slug = url.pathname.startsWith('/api/v1/catalog/')
    ? decodeURIComponent(url.pathname.slice('/api/v1/catalog/'.length))
    : null;

  if (slug && !slugIsValid(slug)) return json({ error: 'Invalid food image slug.' }, 400);

  const canonicalDishId = (url.searchParams.get('dishId') ?? '').trim().slice(0, 100);
  let query = `SELECT slug, dish_name, canonical_dish_id, category, creator, tags_json, license, attribution, source_url, license_evidence_url, variants_json
    FROM food_images WHERE approval_status = 'approved'`;
  const bindings: (string | number)[] = [];
  if (slug) {
    query += ' AND slug = ?';
    bindings.push(slug);
  }
  if (category) {
    query += ' AND lower(category) = ?';
    bindings.push(category);
  }
  if (canonicalDishId) {
    query += ' AND canonical_dish_id = ?';
    bindings.push(canonicalDishId);
  }
  if (search) {
    query += ' AND (lower(dish_name) LIKE ? OR lower(slug) LIKE ? OR lower(tags_json) LIKE ?)';
    const pattern = `%${search}%`;
    bindings.push(pattern, pattern, pattern);
  }
  query += ' ORDER BY dish_name LIMIT ? OFFSET ?';
  bindings.push(limit + 1, offset);

  const results = await env.DB.prepare(query).bind(...bindings).all<FoodImageRow>();
  const selectedRows = results.results ?? [];
  const hasMore = selectedRows.length > limit;
  const pageRows = selectedRows.slice(0, limit);
  const signingKey = pageRows.length ? await importImageSigningKey(env, 'sign') : null;
  const assets = await Promise.all(pageRows.map(async (row) => {
    let tags: string[] = [];
    try {
      const decoded = JSON.parse(row.tags_json) as unknown;
      if (Array.isArray(decoded)) tags = decoded.filter((tag): tag is string => typeof tag === 'string');
    } catch {
      tags = [];
    }
    const variants = parseVariants(row);
    const imageSizes = Object.keys(variants).filter((size) => VARIANT_SIZES.has(size) && variants[size]?.objectKey);
    const signedUrls = imageSizes.length
      ? await signImageUrls(signingKey!, client.id, row.slug, imageSizes, url.origin)
      : {};
    const publicVariants: Record<string, Omit<ImageVariant, 'objectKey'> & { url: string }> = {};
    for (const [size, variant] of Object.entries(variants)) {
      if (!VARIANT_SIZES.has(size) || !variant?.objectKey) continue;
      const signedUrl = signedUrls[size];
      if (!signedUrl) continue;
      publicVariants[size] = {
        width: variant.width,
        height: variant.height,
        byteSize: variant.byteSize,
        format: 'webp',
        url: signedUrl,
      };
    }
    return {
      slug: row.slug,
      dishName: row.dish_name,
      canonicalDishId: row.canonical_dish_id,
      category: row.category,
      creator: row.creator,
      tags,
      license: row.license,
      attribution: row.attribution,
      sourceUrl: row.source_url,
      licenseEvidenceUrl: row.license_evidence_url,
      variants: publicVariants,
    };
  }));

  if (slug && assets.length === 0) return json({ error: 'Food image not found.' }, 404);
  return json({ assets, total: assets.length, hasMore, nextOffset: hasMore ? offset + assets.length : null, contact: env.ACCESS_CONTACT_URL });
}

async function handleSignedImage(request: Request, env: Env, url: URL, context: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, OPTIONS' });
  const pathname = decodeURIComponent(url.pathname);
  const match = /^\/api\/v1\/images\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(480|960|1600)\.webp$/u.exec(pathname);
  if (!match) return json({ error: 'Image not found.' }, 404);

  const [, slug, size] = match;
  const clientId = url.searchParams.get('client') ?? '';
  const expiry = Number.parseInt(url.searchParams.get('exp') ?? '', 10);
  const signature = url.searchParams.get('sig') ?? '';
  if (!clientId || clientId.length > 80 || !(await verifyImageUrl(env, clientId, slug, expiry, signature))) {
    return json({ error: 'This image link is invalid or expired. Fetch a new catalog response with your API key.' }, 401);
  }

  let client: AuthenticatedClient;
  if (clientId === 'owner') {
    client = { id: 'owner', label: 'Acropin owner', owner: true, requestsPerMinute: Number.MAX_SAFE_INTEGER, requestsPerDay: Number.MAX_SAFE_INTEGER };
  } else {
    const row = await env.DB.prepare(
      'SELECT id, label, requests_per_minute, requests_per_day FROM api_keys WHERE id = ? AND revoked_at IS NULL LIMIT 1'
    ).bind(clientId).first<ApiKeyRow>();
    if (!row) return json({ error: 'The API key used to create this image link was revoked.' }, 401);
    client = {
      id: row.id,
      label: row.label,
      owner: false,
      requestsPerMinute: row.requests_per_minute,
      requestsPerDay: row.requests_per_day,
    };
  }

  const limitResponse = await enforceCustomerLimit(client, env);
  if (limitResponse) return limitResponse;

  const image = await env.DB.prepare(
    "SELECT variants_json FROM food_images WHERE slug = ? AND approval_status = 'approved' LIMIT 1"
  ).bind(slug).first<{ variants_json: string }>();
  if (!image) return json({ error: 'Food image not found.' }, 404);

  let variants: Record<string, ImageVariant>;
  try {
    variants = JSON.parse(image.variants_json) as Record<string, ImageVariant>;
  } catch {
    return json({ error: 'Image variant metadata is invalid.' }, 500);
  }
  const variant = variants[size];
  if (!variant?.objectKey || !VARIANT_SIZES.has(size)) return json({ error: 'Requested image size is not available.' }, 404);

  const cacheKey = new Request(`${url.origin}/__acropin_image_cache/${encodeURIComponent(variant.objectKey)}`);
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const object = await env.FOOD_ASSETS.get(variant.objectKey);
  if (!object) return json({ error: 'Image file is missing from storage.' }, 404);

  const cacheSeconds = Math.max(0, Math.min(300, expiry - Math.floor(Date.now() / 1000)));
  const response = new Response(object.body, {
    headers: {
      ...corsHeaders(),
      'Content-Type': object.httpMetadata?.contentType ?? 'image/webp',
      'Content-Length': String(object.size),
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function requireOwner(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  const token = match?.[1]?.trim() ?? '';
  return Boolean(env.OWNER_API_KEY && token && constantTimeEqual(token, env.OWNER_API_KEY));
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await requireOwner(request, env))) return json({ error: 'Owner API key required.' }, 401);

  if (request.method === 'GET' && url.pathname === '/api/v1/admin/keys') {
    const result = await env.DB.prepare(
      'SELECT id, label, requests_per_minute, requests_per_day, created_at, revoked_at FROM api_keys ORDER BY created_at DESC LIMIT 200'
    ).all();
    return json({ keys: result.results ?? [] });
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/admin/keys') {
    let body: { label?: unknown; requestsPerMinute?: unknown; requestsPerDay?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: 'Request body must be valid JSON.' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Request body must be a JSON object.' }, 400);
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
    const rpm = body.requestsPerMinute === undefined ? DEFAULT_REQUESTS_PER_MINUTE : Number(body.requestsPerMinute);
    const daily = body.requestsPerDay === undefined ? DEFAULT_REQUESTS_PER_DAY : Number(body.requestsPerDay);
    if (label.length < 2) return json({ error: 'Set a descriptive label of at least 2 characters.' }, 400);
    if (!Number.isInteger(rpm) || rpm < 1 || rpm > DEFAULT_REQUESTS_PER_MINUTE) {
      return json({ error: `requestsPerMinute must be between 1 and ${DEFAULT_REQUESTS_PER_MINUTE}.` }, 400);
    }
    if (!Number.isInteger(daily) || daily < 1 || daily > DEFAULT_REQUESTS_PER_DAY) {
      return json({ error: `requestsPerDay must be between 1 and ${DEFAULT_REQUESTS_PER_DAY}.` }, 400);
    }

    const id = crypto.randomUUID();
    const key = `acropin_live_${randomToken(32)}`;
    await env.DB.prepare(
      'INSERT INTO api_keys (id, key_hash, label, requests_per_minute, requests_per_day, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, await sha256Hex(key), label, rpm, daily, new Date().toISOString()).run();
    return json({ id, label, apiKey: key, requestsPerMinute: rpm, requestsPerDay: daily, warning: 'Copy this key now. It is shown only once.' }, 201);
  }

  const keyRevoke = /^\/api\/v1\/admin\/keys\/([0-9a-f-]{36})$/u.exec(url.pathname);
  if (request.method === 'DELETE' && keyRevoke) {
    const result = await env.DB.prepare(
      'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'
    ).bind(new Date().toISOString(), keyRevoke[1]).run();
    if (!result.meta.changes) return json({ error: 'Active API key not found.' }, 404);
    return json({ success: true, revokedKeyId: keyRevoke[1] });
  }

  const upsertMatch = /^\/api\/v1\/admin\/catalog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(url.pathname);
  if (request.method === 'PUT' && upsertMatch) {
    const slug = upsertMatch[1];
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json({ error: 'Request body must be valid JSON.' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Request body must be a JSON object.' }, 400);
    const dishName = typeof body.dishName === 'string' ? body.dishName.trim().slice(0, 120) : '';
    const canonicalDishId = typeof body.canonicalDishId === 'string' ? body.canonicalDishId.trim().slice(0, 100) : null;
    const category = typeof body.category === 'string' ? body.category.trim().slice(0, 80) : '';
    const creator = typeof body.creator === 'string' ? body.creator.trim().slice(0, 200) : '';
    const license = typeof body.license === 'string' ? body.license.trim().slice(0, 80) : '';
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 30) : [];
    const attribution = typeof body.attribution === 'string' ? body.attribution.trim().slice(0, 500) : null;
    const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim().slice(0, 2048) : null;
    const licenseEvidenceUrl = typeof body.licenseEvidenceUrl === 'string' ? body.licenseEvidenceUrl.trim().slice(0, 2048) : null;
    const requestedSizes = Array.isArray(body.variantSizes)
      ? body.variantSizes.filter((size): size is string => typeof size === 'string')
      : null;
    if (!dishName || !category || !creator || !license) return json({ error: 'dishName, category, creator, and license are required.' }, 400);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(category)) return json({ error: 'category must be lowercase kebab-case.' }, 400);
    if (license !== 'CC0-1.0' && license !== 'CC-BY-4.0') return json({ error: 'license must be CC0-1.0 or CC-BY-4.0.' }, 400);
    if (license === 'CC-BY-4.0' && !attribution) return json({ error: 'Attribution text is required for CC-BY-4.0.' }, 400);
    for (const link of [sourceUrl, licenseEvidenceUrl]) {
      if (link && !link.startsWith('https://')) return json({ error: 'Source and license evidence URLs must use HTTPS.' }, 400);
    }
    if (requestedSizes && requestedSizes.some((size) => !VARIANT_SIZES.has(size))) {
      return json({ error: 'variantSizes may contain only 480, 960, and 1600.' }, 400);
    }

    const now = new Date().toISOString();
    const existing = await env.DB.prepare('SELECT variants_json FROM food_images WHERE slug = ? LIMIT 1').bind(slug).first<{ variants_json: string }>();
    let variants: Record<string, ImageVariant> = {};
    if (existing) {
      try {
        variants = JSON.parse(existing.variants_json) as Record<string, ImageVariant>;
      } catch {
        variants = {};
      }
    }
    if (requestedSizes) {
      const retained = new Set(requestedSizes);
      const obsoleteKeys = Object.entries(variants)
        .filter(([size]) => !retained.has(size))
        .map(([, variant]) => variant.objectKey);
      variants = Object.fromEntries(Object.entries(variants).filter(([size]) => retained.has(size)));
      await Promise.all(obsoleteKeys.map((key) => env.FOOD_ASSETS.delete(key)));
    }

    await env.DB.prepare(`INSERT INTO food_images (slug, dish_name, canonical_dish_id, category, creator, tags_json, license, attribution, source_url, license_evidence_url, variants_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET dish_name = excluded.dish_name, canonical_dish_id = excluded.canonical_dish_id, category = excluded.category, creator = excluded.creator, tags_json = excluded.tags_json, license = excluded.license, attribution = excluded.attribution, source_url = excluded.source_url, license_evidence_url = excluded.license_evidence_url, variants_json = excluded.variants_json, approval_status = 'approved', updated_at = excluded.updated_at`)
      .bind(slug, dishName, canonicalDishId, category, creator, JSON.stringify(tags), license, attribution, sourceUrl, licenseEvidenceUrl, JSON.stringify(variants), now, now).run();
    return json({ success: true, slug, next: `Upload approved WebP variants to /api/v1/admin/catalog/${slug}/variants/{480|960|1600}.webp` });
  }

  const uploadMatch = /^\/api\/v1\/admin\/catalog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/variants\/(480|960|1600)\.webp$/u.exec(url.pathname);
  if (request.method === 'PUT' && uploadMatch) {
    const [, slug, size] = uploadMatch;
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('image/webp')) {
      return json({ error: 'Upload a processed image/webp file.' }, 415);
    }
    const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_IMAGE_BYTES) {
      return json({ error: 'Provide a non-empty image with Content-Length no greater than 10 MB.' }, 413);
    }
    const buffer = await request.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES || buffer.byteLength !== declaredLength) {
      return json({ error: 'Image is empty, too large, or its Content-Length did not match.' }, 413);
    }
    const bytes = new Uint8Array(buffer);
    const isWebp = bytes.byteLength >= 12
      && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
    if (!isWebp) return json({ error: 'The uploaded file is not a valid WebP container.' }, 415);

    const row = await env.DB.prepare('SELECT variants_json FROM food_images WHERE slug = ? LIMIT 1').bind(slug).first<{ variants_json: string }>();
    if (!row) return json({ error: 'Create the catalog record before uploading its variants.' }, 404);
    let variants: Record<string, ImageVariant>;
    try {
      variants = JSON.parse(row.variants_json) as Record<string, ImageVariant>;
    } catch {
      variants = {};
    }
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const contentHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const objectKey = `food-assets/${slug}/${size}/${contentHash}.webp`;
    const previousObjectKey = variants[size]?.objectKey;
    await env.FOOD_ASSETS.put(objectKey, buffer, {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { slug, size },
    });
    variants[size] = { objectKey, width: Number(size), height: Number(size), byteSize: buffer.byteLength, format: 'webp' };
    await env.DB.prepare('UPDATE food_images SET variants_json = ?, updated_at = ? WHERE slug = ?')
      .bind(JSON.stringify(variants), new Date().toISOString(), slug).run();
    if (previousObjectKey && previousObjectKey !== objectKey) await env.FOOD_ASSETS.delete(previousObjectKey);
    return json({ success: true, slug, size, byteSize: buffer.byteLength });
  }

  const catalogDelete = /^\/api\/v1\/admin\/catalog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(url.pathname);
  if (request.method === 'DELETE' && catalogDelete) {
    const slug = catalogDelete[1];
    const row = await env.DB.prepare('SELECT variants_json FROM food_images WHERE slug = ? LIMIT 1').bind(slug).first<{ variants_json: string }>();
    if (!row) return json({ error: 'Catalog entry not found.' }, 404);
    const variants = JSON.parse(row.variants_json) as Record<string, ImageVariant>;
    await Promise.all(Object.values(variants).map((variant) => env.FOOD_ASSETS.delete(variant.objectKey)));
    await env.DB.prepare('DELETE FROM food_images WHERE slug = ?').bind(slug).run();
    return json({ success: true, slug });
  }

  return json({ error: 'Admin API route not found.' }, 404);
}

export class ApiKeyRateLimiter {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const body = await request.json() as {
      requestsPerMinute: number;
      requestsPerDay: number;
      now: number;
    };
    const rpm = Math.max(1, Math.floor(body.requestsPerMinute));
    const daily = Math.max(1, Math.floor(body.requestsPerDay));
    const nowSeconds = Math.floor((Number.isFinite(body.now) ? body.now : Date.now()) / 1000);
    const minuteWindow = Math.floor(nowSeconds / 60);
    const dayWindow = Math.floor(nowSeconds / 86_400);

    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS counters (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      minute_window INTEGER NOT NULL,
      minute_count INTEGER NOT NULL,
      day_window INTEGER NOT NULL,
      day_count INTEGER NOT NULL
    )`);

    const current = this.storage.sql.exec<{
      minute_window: number;
      minute_count: number;
      day_window: number;
      day_count: number;
    }>('SELECT minute_window, minute_count, day_window, day_count FROM counters WHERE id = 1').toArray()[0];

    const minuteCount = current?.minute_window === minuteWindow ? current.minute_count : 0;
    const dayCount = current?.day_window === dayWindow ? current.day_count : 0;
    const minuteBlocked = minuteCount >= rpm;
    const dayBlocked = dayCount >= daily;
    const retryAfter = minuteBlocked
      ? Math.max(1, 60 - (nowSeconds % 60))
      : Math.max(1, 86_400 - (nowSeconds % 86_400));

    if (!minuteBlocked && !dayBlocked) {
      this.storage.sql.exec(`INSERT INTO counters (id, minute_window, minute_count, day_window, day_count)
        VALUES (1, ?, 1, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          minute_window = excluded.minute_window,
          minute_count = CASE WHEN counters.minute_window = excluded.minute_window THEN counters.minute_count + 1 ELSE 1 END,
          day_window = excluded.day_window,
          day_count = CASE WHEN counters.day_window = excluded.day_window THEN counters.day_count + 1 ELSE 1 END`,
      minuteWindow, dayWindow);
    }

    return Response.json({
      allowed: !minuteBlocked && !dayBlocked,
      remainingMinute: Math.max(0, rpm - minuteCount - (minuteBlocked || dayBlocked ? 0 : 1)),
      remainingDay: Math.max(0, daily - dayCount - (minuteBlocked || dayBlocked ? 0 : 1)),
      retryAfter: minuteBlocked || dayBlocked ? retryAfter : 0,
    });
  }
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v1/')) return json({ error: 'This host serves the Acropin Food Images API only.' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    try {
      if (url.pathname === '/api/v1/health' && request.method === 'GET') {
        return json({ ok: true, service: 'Acropin Food Images API', contact: env.ACCESS_CONTACT_URL });
      }

      if (url.pathname.startsWith('/api/v1/images/')) return await handleSignedImage(request, env, url, context);
      if (url.pathname.startsWith('/api/v1/admin/')) return await handleAdmin(request, env, url);

      if (url.pathname === '/api/v1/catalog' || url.pathname.startsWith('/api/v1/catalog/')) {
        if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, OPTIONS' });
        const client = await authenticate(request, env);
        if (!client) return json({ error: 'API access requires an approved key. Contact the owner to request a free key.', contact: env.ACCESS_CONTACT_URL }, 401);
        const limitResponse = await enforceCustomerLimit(client, env);
        if (limitResponse) return limitResponse;
        return await handleCatalogRequest(request, env, client);
      }

      return json({ error: `API route not found: ${request.method} ${url.pathname}` }, 404);
    } catch (error) {
      console.error('Acropin API request failed:', error);
      return json({ error: 'Internal API error.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
