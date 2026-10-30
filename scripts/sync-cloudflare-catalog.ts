/** Publish the validated, generated food image catalog to the Cloudflare API. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

type Variant = {
  width: number;
  height: number;
  byteSize: number;
};

type FoodImage = {
  slug: string;
  dishName: string;
  category: string;
  creator: string;
  canonicalDishId?: string;
  tags: string[];
  sourceUrl: string;
  license: 'CC0-1.0' | 'CC-BY-4.0';
  licenseEvidenceUrl: string;
  attribution?: string;
  variants: Record<string, Variant>;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDist = path.join(projectRoot, 'packages/food-images/dist');
const contributionsRoot = path.join(projectRoot, 'packages/food-images/contributions');
const MAX_MASTER_EDGE = 1600;
const MAX_SOURCE_PIXELS = 30_000_000;
const MAX_MASTER_BYTES = 20 * 1024 * 1024;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

async function requestApi(url: URL, apiKey: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Cloudflare API returned HTTP ${response.status} for ${url.pathname}: ${detail}`);
  }
}

async function createLosslessMaster(slug: string): Promise<{ bytes: Buffer; width: number; height: number }> {
  const contributionPath = path.join(contributionsRoot, slug);
  const files = await fs.readdir(contributionPath, { withFileTypes: true });
  const sourceFiles = files.filter((file) => file.isFile() && file.name.startsWith('source.'));
  if (sourceFiles.length !== 1) {
    throw new Error(`${slug}: expected exactly one original source image in its contribution folder.`);
  }

  const source = await fs.readFile(path.join(contributionPath, sourceFiles[0].name));
  const { data, info } = await sharp(source, { failOn: 'error', limitInputPixels: MAX_SOURCE_PIXELS })
    .rotate()
    .resize(MAX_MASTER_EDGE, MAX_MASTER_EDGE, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .toColorspace('srgb')
    .webp({ lossless: true, effort: 6 })
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height || Math.max(info.width, info.height) > MAX_MASTER_EDGE) {
    throw new Error(`${slug}: generated master dimensions are invalid.`);
  }
  if (data.byteLength > MAX_MASTER_BYTES) {
    throw new Error(`${slug}: lossless master exceeds the Cloudflare Images 20 MB input limit.`);
  }
  return { bytes: data, width: info.width, height: info.height };
}

async function main() {
  const apiBase = requiredEnvironment('CLOUDFLARE_FOOD_API_URL').replace(/\/+$/u, '');
  const apiKey = requiredEnvironment('CLOUDFLARE_OWNER_API_KEY');
  const catalog = JSON.parse(await fs.readFile(path.join(packageDist, 'catalog.json'), 'utf8')) as FoodImage[];

  for (const image of catalog) {
    const master = await createLosslessMaster(image.slug);
    const metadataUrl = new URL(`/api/v1/admin/catalog/${encodeURIComponent(image.slug)}`, apiBase);
    await requestApi(metadataUrl, apiKey, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dishName: image.dishName,
        category: image.category,
        creator: image.creator,
        canonicalDishId: image.canonicalDishId,
        tags: image.tags,
        license: image.license,
        attribution: image.attribution,
        sourceUrl: image.sourceUrl,
        licenseEvidenceUrl: image.licenseEvidenceUrl,
      }),
    });

    const sourceUrl = new URL(
      `/api/v1/admin/catalog/${encodeURIComponent(image.slug)}/source.webp`,
      apiBase
    );
    await requestApi(sourceUrl, apiKey, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(master.bytes.byteLength),
        'X-Source-Width': String(master.width),
        'X-Source-Height': String(master.height),
      },
      body: (() => {
        const bytes = new ArrayBuffer(master.bytes.byteLength);
        new Uint8Array(bytes).set(master.bytes);
        return bytes;
      })(),
    });
    console.log(`Synced ${image.slug} with one lossless ${master.width}×${master.height} WebP master; sizes and formats render on demand.`);
  }

  console.log(`Cloudflare catalog sync complete: ${catalog.length} image(s).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
