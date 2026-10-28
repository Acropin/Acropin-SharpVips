/** Publish the validated, generated food image catalog to the Cloudflare API. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function main() {
  const apiBase = requiredEnvironment('CLOUDFLARE_FOOD_API_URL').replace(/\/+$/u, '');
  const apiKey = requiredEnvironment('CLOUDFLARE_OWNER_API_KEY');
  const catalog = JSON.parse(await fs.readFile(path.join(packageDist, 'catalog.json'), 'utf8')) as FoodImage[];

  for (const image of catalog) {
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
        variantSizes: Object.keys(image.variants),
      }),
    });

    for (const [size, variant] of Object.entries(image.variants)) {
      if (!['480', '960', '1600'].includes(size)) continue;
      const filePath = path.join(packageDist, 'assets', image.slug, `${size}.webp`);
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength !== variant.byteSize) {
        throw new Error(`${image.slug}/${size}: generated file size does not match catalog metadata.`);
      }
      const variantUrl = new URL(
        `/api/v1/admin/catalog/${encodeURIComponent(image.slug)}/variants/${size}.webp`,
        apiBase
      );
      await requestApi(variantUrl, apiKey, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(bytes.byteLength),
        },
        body: bytes,
      });
    }
    console.log(`Synced ${image.slug} (${Object.keys(image.variants).join(', ')} px variants).`);
  }

  console.log(`Cloudflare catalog sync complete: ${catalog.length} image(s).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
