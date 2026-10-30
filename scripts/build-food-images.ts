/**
 * Validate community image contributions and build the npm package catalog.
 * Generated files are deliberately excluded from source control and rebuilt
 * during local development, Vercel builds, and npm packaging.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { processFoodImage } from '../src/lib/images/process-image.js';
import {
  MAX_PERCEPTUAL_DUPLICATE_DISTANCE,
  perceptualHashDistance,
} from '../src/lib/images/perceptual-hash.js';

type ContributionMetadata = {
  dishName: string;
  category: string;
  canonicalDishId?: string;
  tags: string[];
  creator: string;
  sourceUrl: string;
  license: 'CC0-1.0' | 'CC-BY-4.0';
  licenseEvidenceUrl: string;
  attribution?: string;
  focalPoint?: { x: number; y: number };
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'packages/food-images');
const contributionsRoot = path.join(packageRoot, 'contributions');
const outputRoot = path.join(packageRoot, 'dist');
const sourceExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.heif', '.heic']);
const prohibitedSourceHosts = [
  'unsplash.com',
  'pexels.com',
  'shutterstock.com',
  'gettyimages.com',
  'istockphoto.com',
  'adobe.com',
  'freepik.com',
];
const variantSizes = [480, 960, 1600] as const;

function fail(slug: string, message: string): never {
  throw new Error(`Contribution "${slug}": ${message}`);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !(
      ['example', 'example.com', 'example.org', 'localhost', 'local', 'test', 'invalid'].includes(host) ||
      ['.example', '.example.com', '.example.org', '.localhost', '.local', '.test', '.invalid']
        .some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

function checkUrl(slug: string, fieldName: string, value: unknown): asserts value is string {
  if (!isHttpsUrl(value)) fail(slug, `${fieldName} must be a valid HTTPS URL.`);
}

function normalizedTags(value: unknown, slug: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((tag) => typeof tag !== 'string')) {
    fail(slug, 'tags must be a non-empty array of strings.');
  }
  const tags = [...new Set(value.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (tags.some((tag) => /replace|useful|^with$/.test(tag))) fail(slug, 'replace the example tags with real tags.');
  return tags;
}

function validateMetadata(value: unknown, slug: string): ContributionMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(slug, 'metadata.json must contain a JSON object.');
  const data = value as Record<string, unknown>;
  if (typeof data.dishName !== 'string' || data.dishName.trim().length < 2 || data.dishName.length > 100) {
    fail(slug, 'dishName must be between 2 and 100 characters.');
  }
  if (/replace with/i.test(data.dishName)) fail(slug, 'replace the dishName example text.');
  const category = typeof data.category === 'string' ? data.category.trim().toLowerCase() : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category) || category.length > 80) {
    fail(slug, 'category must be a short lowercase kebab-case value such as "pizza", "fruit", or "beverages".');
  }
  if (typeof data.creator !== 'string' || data.creator.trim().length < 2) {
    fail(slug, 'creator must identify the image creator or rightsholder.');
  }
  if (/your name|rightsholder/i.test(data.creator)) fail(slug, 'replace the creator example text with the actual creator or rightsholder.');
  if (data.license !== 'CC0-1.0' && data.license !== 'CC-BY-4.0') {
    fail(slug, 'license must be CC0-1.0 or CC-BY-4.0.');
  }
  checkUrl(slug, 'sourceUrl', data.sourceUrl);
  checkUrl(slug, 'licenseEvidenceUrl', data.licenseEvidenceUrl);
  const sourceHost = new URL(data.sourceUrl).hostname.toLowerCase();
  const evidenceHost = new URL(data.licenseEvidenceUrl).hostname.toLowerCase();
  if (sourceHost === 'example.com' || sourceHost.endsWith('.example.com') || sourceHost === 'example.org') {
    fail(slug, 'replace the sourceUrl example text with the real image source.');
  }
  if (evidenceHost === 'example.com' || evidenceHost.endsWith('.example.com') || evidenceHost === 'example.org') {
    fail(slug, 'replace the licenseEvidenceUrl example text with image-specific evidence.');
  }
  if (data.sourceUrl === data.licenseEvidenceUrl) {
    fail(slug, 'sourceUrl is not license evidence; provide a separate image-specific license evidence URL.');
  }
  if (prohibitedSourceHosts.some((host) => sourceHost === host || sourceHost.endsWith(`.${host}`))) {
    fail(slug, `images from ${sourceHost} are not accepted; provide an image with explicit rights to redistribute in this library.`);
  }
  if (data.license === 'CC-BY-4.0' && (typeof data.attribution !== 'string' || !data.attribution.trim())) {
    fail(slug, 'attribution text is required for CC-BY-4.0.');
  }
  if (typeof data.attribution === 'string' && /required for cc-by|include creator, title/i.test(data.attribution)) {
    fail(slug, 'replace the attribution example text with the actual attribution.');
  }
  if (data.canonicalDishId !== undefined && typeof data.canonicalDishId !== 'string') {
    fail(slug, 'canonicalDishId must be a string when provided.');
  }
  let focalPoint: ContributionMetadata['focalPoint'];
  if (data.focalPoint !== undefined) {
    if (!data.focalPoint || typeof data.focalPoint !== 'object') fail(slug, 'focalPoint must have x and y values between 0 and 1.');
    const point = data.focalPoint as Record<string, unknown>;
    if (typeof point.x !== 'number' || typeof point.y !== 'number' || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      fail(slug, 'focalPoint must have x and y values between 0 and 1.');
    }
    focalPoint = { x: point.x, y: point.y };
  }
  return {
    dishName: data.dishName.trim(),
    category,
    canonicalDishId: typeof data.canonicalDishId === 'string' && data.canonicalDishId.trim() ? data.canonicalDishId.trim() : undefined,
    tags: normalizedTags(data.tags, slug),
    creator: data.creator.trim(),
    sourceUrl: data.sourceUrl,
    license: data.license,
    licenseEvidenceUrl: data.licenseEvidenceUrl,
    attribution: typeof data.attribution === 'string' && data.attribution.trim() ? data.attribution.trim() : undefined,
    focalPoint,
  };
}

async function main() {
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string };
  const entries = await fs.readdir(contributionsRoot, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const slugs = new Set<string>();
  const hashes = new Set<string>();
  const perceptualHashes: Array<{ slug: string; hash: string }> = [];
  const foodImages = [] as Array<Record<string, unknown>>;

  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(outputRoot, 'assets'), { recursive: true });
  await fs.copyFile(path.join(packageRoot, 'api-client.js'), path.join(outputRoot, 'api.js'));
  await fs.copyFile(path.join(packageRoot, 'api-client.d.ts'), path.join(outputRoot, 'api.d.ts'));

  for (const folder of folders) {
    const slug = folder.name;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
      fail(slug, 'folder name must be a unique lowercase kebab-case slug of at most 64 characters.');
    }
    if (slugs.has(slug)) fail(slug, 'duplicate slug.');
    slugs.add(slug);

    const contributionPath = path.join(contributionsRoot, slug);
    const files = await fs.readdir(contributionPath, { withFileTypes: true });
    const sourceFiles = files.filter((file) => file.isFile() && file.name.startsWith('source.'));
    if (sourceFiles.length !== 1) fail(slug, 'add exactly one source.<extension> image file.');
    const sourceFile = sourceFiles[0].name;
    if (!sourceExtensions.has(path.extname(sourceFile).toLowerCase())) fail(slug, 'source image format is unsupported.');
    const sourcePath = path.join(contributionPath, sourceFile);
    const sourceStat = await fs.stat(sourcePath);
    if (sourceStat.size > 15 * 1024 * 1024) fail(slug, 'source image exceeds the 15 MB limit.');

    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse(await fs.readFile(path.join(contributionPath, 'metadata.json'), 'utf8'));
    } catch (error) {
      fail(slug, `metadata.json is missing or invalid JSON (${error instanceof Error ? error.message : String(error)}).`);
    }
    const metadata = validateMetadata(rawMetadata, slug);
    const original = await fs.readFile(sourcePath);
    const processed = await processFoodImage(original, { focalPoint: metadata.focalPoint });
    if (hashes.has(processed.hash)) fail(slug, 'duplicate normalized image content; use a different image.');
    hashes.add(processed.hash);
    const nearDuplicate = perceptualHashes.find(({ hash }) =>
      perceptualHashDistance(hash, processed.perceptualHash) <= MAX_PERCEPTUAL_DUPLICATE_DISTANCE
    );
    if (nearDuplicate) {
      fail(slug, `image is visually too similar to "${nearDuplicate.slug}" (pHash distance is at most ${MAX_PERCEPTUAL_DUPLICATE_DISTANCE}/64).`);
    }
    perceptualHashes.push({ slug, hash: processed.perceptualHash });

    const sourceMaxEdge = Math.max(processed.sourceDimensions.width, processed.sourceDimensions.height);
    const availableSizes = variantSizes.filter((size) => size <= sourceMaxEdge);
    const variants: Record<string, Record<string, unknown>> = {};
    const variantsDir = path.join(outputRoot, 'assets', slug);
    await fs.mkdir(variantsDir, { recursive: true });
    await fs.writeFile(path.join(outputRoot, 'assets', `${slug}.webp`), processed.buffer);

    for (const size of availableSizes) {
      const variant = size === 480
        ? {
            buffer: processed.buffer,
            width: processed.width,
            height: processed.height,
            format: processed.format,
            hash: processed.hash,
            byteSize: processed.byteSize,
          }
        : size === 960 && processed.retinaBuffer && processed.retinaWidth && processed.retinaHeight
          ? {
              buffer: processed.retinaBuffer,
              width: processed.retinaWidth,
              height: processed.retinaHeight,
              format: processed.format,
              hash: createHash('sha256').update(processed.retinaBuffer).digest('hex'),
              byteSize: processed.retinaBuffer.length,
            }
          : size === 1600 && processed.hiResBuffer && processed.hiResWidth && processed.hiResHeight
            ? {
                buffer: processed.hiResBuffer,
                width: processed.hiResWidth,
                height: processed.hiResHeight,
                format: processed.format,
                hash: createHash('sha256').update(processed.hiResBuffer).digest('hex'),
                byteSize: processed.hiResBuffer.length,
              }
            : fail(slug, `source does not support the ${size}px variant.`);
      const variantPath = path.join(variantsDir, `${size}.webp`);
      await fs.writeFile(variantPath, variant.buffer);
      variants[String(size)] = {
        url: size === 480
          ? `https://cdn.jsdelivr.net/npm/acropin-food-images@${packageJson.version}/dist/assets/${slug}.webp`
          : `https://cdn.jsdelivr.net/npm/acropin-food-images@${packageJson.version}/dist/assets/${slug}/${size}.webp`,
        width: variant.width,
        height: variant.height,
        format: variant.format,
        sha256: variant.hash,
        byteSize: variant.byteSize,
      };
    }

    foodImages.push({
      id: `food-${slug}`,
      slug,
      dishName: metadata.dishName,
      category: metadata.category,
      canonicalDishId: metadata.canonicalDishId,
      tags: metadata.tags,
      creator: metadata.creator,
      sourceUrl: metadata.sourceUrl,
      license: metadata.license,
      licenseEvidenceUrl: metadata.licenseEvidenceUrl,
      attribution: metadata.attribution,
      url: String(variants['480'].url),
      variants,
      sha256: processed.hash,
      perceptualHash: processed.perceptualHash,
      width: processed.width,
      height: processed.height,
      format: processed.format,
      byteSize: processed.byteSize,
      originalByteSize: original.byteLength,
      focalPoint: processed.focalPoint,
    });
  }

  await fs.writeFile(path.join(outputRoot, 'catalog.json'), `${JSON.stringify(foodImages, null, 2)}\n`);
  await fs.writeFile(
    path.join(outputRoot, 'catalog.js'),
    `export const foodImages = Object.freeze(${JSON.stringify(foodImages)}.map((image) => Object.freeze(image)));\n`
  );
  await fs.writeFile(
    path.join(outputRoot, 'index.js'),
    `import { foodImages } from './catalog.js';\n\n` +
      `export { foodImages };\n` +
      `export const packageVersion = ${JSON.stringify(packageJson.version)};\n` +
      `export function getFoodImage(identifier) {\n` +
      `  if (typeof identifier !== 'string') return undefined;\n` +
      `  const key = identifier.trim().toLowerCase();\n` +
      `  return foodImages.find((image) => image.slug === key || image.id === key || image.canonicalDishId === key);\n` +
      `}\n` +
      `export function getFoodImageUrl(identifier, size = 480) {\n` +
      `  const image = getFoodImage(identifier);\n` +
      `  return image?.variants?.[size]?.url;\n` +
      `}\n` +
      `export function searchFoodImages(query = '', filters = {}) {\n` +
      `  const q = query.trim().toLowerCase();\n` +
      `  return foodImages.filter((image) => {\n` +
      `    if (filters.license && image.license !== filters.license) return false;\n` +
      `    if (filters.tags?.some((tag) => !image.tags.includes(tag.toLowerCase()))) return false;\n` +
      `    return !q || [image.slug, image.dishName, ...image.tags].some((value) => value.toLowerCase().includes(q));\n` +
      `  });\n` +
      `}\n` +
      `export { createFoodImageClient, AcropinFoodImagesClient, FoodImageApiError } from './api.js';\n`
  );
  await fs.writeFile(
    path.join(outputRoot, 'index.d.ts'),
    `export type FoodImageLicense = 'CC0-1.0' | 'CC-BY-4.0';\n` +
      `export type FoodImageSize = 480 | 960 | 1600;\n` +
      `export interface FoodImageVariant { url: string; width: number; height: number; format: 'webp'; sha256: string; byteSize: number; }\n` +
      `export interface FoodImage {\n` +
      `  id: string; slug: string; dishName: string; category: string; canonicalDishId?: string; tags: readonly string[];\n` +
      `  creator: string; sourceUrl: string; license: FoodImageLicense; licenseEvidenceUrl: string; attribution?: string;\n` +
      `  url: string; variants: Readonly<Partial<Record<FoodImageSize, Readonly<FoodImageVariant>>>>; sha256: string; perceptualHash: string; width: number; height: number; format: 'webp'; byteSize: number; originalByteSize: number;\n` +
      `  focalPoint: Readonly<{ x: number; y: number }>;\n` +
      `}\n` +
      `export const foodImages: readonly FoodImage[];\n` +
      `export const packageVersion: string;\n` +
      `export function getFoodImage(identifier: string): FoodImage | undefined;\n` +
      `export function getFoodImageUrl(identifier: string, size?: FoodImageSize): string | undefined;\n` +
      `export function searchFoodImages(query?: string, filters?: { tags?: string[]; license?: FoodImageLicense }): FoodImage[];\n` +
      `export { createFoodImageClient, AcropinFoodImagesClient, FoodImageApiError } from './api.js';\n` +
      `export type { ApiFoodImage, FoodImageApiSize, FoodImageApiVariant, FoodImageCatalogOptions, FoodImageCatalogResult, FoodImageClientOptions } from './api.js';\n`
  );
  console.log(`Built acropin-food-images ${packageJson.version}: ${foodImages.length} image(s).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
