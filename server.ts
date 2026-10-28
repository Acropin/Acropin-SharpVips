/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { processFoodImage } from './src/lib/images/process-image.js';
import { getStorageProvider } from './src/lib/storage/image-storage.js';
import {
  initializeCatalog,
  getAllAssets,
  getAssetById,
  findAssetByHash,
  registerAsset,
  deleteAsset,
  isPackageAsset,
  updateAssetStatus,
  flushCatalog,
} from './src/lib/server/catalog-store.js';
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
import type { AssetApprovalStatus, ImageAsset, LicenseType } from './src/lib/images/types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const vercelRequestLimit = process.env.VERCEL === '1' ? '4mb' : '10mb';

app.use(express.json({ limit: vercelRequestLimit }));
app.use(express.urlencoded({ extended: true, limit: vercelRequestLimit }));

// Mutating routes are admin-only in production. Public menu and catalog reads
// remain available to the customer-facing view.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    next();
    return;
  }

  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected && process.env.VERCEL === '1') {
    res.status(503).json({ error: 'Admin actions are disabled until ADMIN_API_TOKEN is configured.' });
    return;
  }
  if (!expected) {
    next();
    return;
  }

  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  const matches = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
  if (!matches) {
    res.status(401).json({ error: 'A valid admin access code is required.' });
    return;
  }
  next();
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

// -------------------------------------------------------------
// Image Serving Route with Immutable CDN Caching Headers
// -------------------------------------------------------------
app.get('/api/images/food-assets/*', async (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  const storage = getStorageProvider();
  const key = `food-assets/${relPath}`;

  try {
    const item = await storage.get(key);
    if (!item) {
      res.status(404).json({ error: 'Image asset not found.' });
      return;
    }

    res.setHeader('Content-Type', item.contentType || 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(item.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve image asset.' });
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
    const success = await deleteAsset(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Asset not found in collection.' });
      return;
    }
    res.json({ success: true, message: 'Asset deleted from library.' });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Upload and process an image
app.post('/api/images/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No image file uploaded.' });
      return;
    }

    const {
      dishName,
      universalName: clientUniversalName,
      canonicalDishId,
      focalPointX,
      focalPointY,
      licenseType,
      licenseEvidence,
      requiredAttribution,
      sourceProvider,
    } = req.body;

    const fx = focalPointX ? parseFloat(focalPointX) : 0.5;
    const fy = focalPointY ? parseFloat(focalPointY) : 0.5;

    // Execute Sharp Processing Engine
    const processed = await processFoodImage(req.file.buffer, {
      width: 480,
      height: 480,
      initialQuality: 78,
      effort: 5,
      focalPoint: { x: fx, y: fy },
    });

    // Derive standardized single universal food name and default filename
    const targetRawName = clientUniversalName || dishName || req.file.originalname;
    const universal = toUniversalFoodName(targetRawName);
    const assetId = `asset_${universal.universalName}`;
    const storageKey = `food-assets/${universal.universalName}/480.webp`;
    const storage = getStorageProvider();

    const uploadResult = await storage.upload(storageKey, processed.buffer, 'image/webp');
    const duplicateAsset = findAssetByHash(processed.hash);
    const now = new Date().toISOString();

    const newAsset: ImageAsset = {
      id: assetId,
      universalName: universal.universalName,
      filename: universal.filename,
      dishName: universal.displayName,
      canonicalDishId: canonicalDishId || undefined,
      storageKey: uploadResult.key,
      publicUrl: uploadResult.url,
      sha256Hash: processed.hash,
      width: processed.width,
      height: processed.height,
      format: 'webp',
      originalByteSize: req.file.buffer.length,
      byteSize: processed.byteSize,
      sourceProvider: sourceProvider || 'Upload',
      licenseType: (licenseType as LicenseType) || 'CC0',
      licenseEvidence: licenseEvidence || 'Direct Upload',
      requiredAttribution: requiredAttribution || undefined,
      processingVersion: 'v1',
      processingQuality: processed.qualityUsed,
      focalPoint: { x: fx, y: fy },
      approvalStatus: 'approved',
      createdAt: now,
      updatedAt: now,
      tags: [universal.universalName, 'food-photo'],
    };

    registerAsset(newAsset);
    await flushCatalog();
    const match = matchCanonicalDish(universal.displayName);

    res.status(201).json({
      asset: newAsset,
      canonicalMatch: match,
      isDeduplicated: Boolean(duplicateAsset),
      existingDuplicateId: duplicateAsset?.id,
      warning: processed.sizeDeviationWarning,
      sourceDimensions: processed.sourceDimensions,
      compressionRatio: ((1 - processed.byteSize / req.file.buffer.length) * 100).toFixed(1) + '%',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

// Process an open source image via remote URL
app.post('/api/images/process-url', async (req, res) => {
  try {
    const {
      imageUrl,
      dishName,
      universalName: clientUniversalName,
      canonicalDishId,
      focalPointX,
      focalPointY,
      licenseType,
      licenseEvidence,
      requiredAttribution,
      sourceProvider,
    } = req.body;

    let buffer: Buffer;

    if (imageUrl.startsWith('data:image/')) {
      const base64Data = imageUrl.split(';base64,').pop();
      if (!base64Data) {
        res.status(400).json({ error: 'Invalid base64 data URI format.' });
        return;
      }
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        res.status(400).json({ error: 'Please provide a valid http or https image URL.' });
        return;
      }

      // Safely fetch remote image with timeout, redirect following, and browser headers
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(imageUrl, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          res.status(400).json({
            error: `Failed to fetch image from URL (Remote server returned HTTP ${response.status} ${response.statusText}).`,
          });
          return;
        }

        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } catch (fetchErr: unknown) {
        clearTimeout(timeout);
        res.status(400).json({
          error: `Could not download image from the provided URL: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        });
        return;
      }
    }

    if (buffer.length > 15 * 1024 * 1024) {
      res.status(400).json({ error: 'Fetched image exceeds 15 MB limit.' });
      return;
    }

    const fx = focalPointX ? parseFloat(focalPointX) : 0.5;
    const fy = focalPointY ? parseFloat(focalPointY) : 0.5;

    // Process through Sharp
    const processed = await processFoodImage(buffer, {
      width: 480,
      height: 480,
      initialQuality: 78,
      effort: 5,
      focalPoint: { x: fx, y: fy },
    });

    // Derive standardized single universal food name and default filename
    let rawRef = dishName;
    if (!rawRef && !imageUrl.startsWith('data:')) {
      try {
        rawRef = new URL(imageUrl).pathname.split('/').pop() || 'food-item';
      } catch {
        rawRef = 'food-item';
      }
    }

    const universal = toUniversalFoodName(clientUniversalName || rawRef || 'food-dish');
    const assetId = `asset_${universal.universalName}`;
    const storageKey = `food-assets/${universal.universalName}/480.webp`;
    const storage = getStorageProvider();

    const uploadResult = await storage.upload(storageKey, processed.buffer, 'image/webp');
    const duplicateAsset = findAssetByHash(processed.hash);
    const now = new Date().toISOString();

    const newAsset: ImageAsset = {
      id: assetId,
      universalName: universal.universalName,
      filename: universal.filename,
      dishName: universal.displayName,
      canonicalDishId: canonicalDishId || undefined,
      storageKey: uploadResult.key,
      publicUrl: uploadResult.url,
      sha256Hash: processed.hash,
      width: processed.width,
      height: processed.height,
      format: 'webp',
      originalByteSize: buffer.length,
      byteSize: processed.byteSize,
      sourceUrl: imageUrl.startsWith('data:') ? undefined : imageUrl,
      sourceProvider: sourceProvider || (imageUrl.startsWith('data:') ? 'Pasted Image' : new URL(imageUrl).hostname),
      licenseType: (licenseType as LicenseType) || 'CC0',
      licenseEvidence: licenseEvidence || (imageUrl.startsWith('data:') ? 'Clipboard' : imageUrl),
      requiredAttribution: requiredAttribution || undefined,
      processingVersion: 'v1',
      processingQuality: processed.qualityUsed,
      focalPoint: { x: fx, y: fy },
      approvalStatus: 'approved',
      createdAt: now,
      updatedAt: now,
      tags: [universal.universalName, 'open-source-url'],
    };

    registerAsset(newAsset);
    await flushCatalog();
    const match = matchCanonicalDish(universal.displayName);

    res.status(201).json({
      asset: newAsset,
      canonicalMatch: match,
      isDeduplicated: Boolean(duplicateAsset),
      existingDuplicateId: duplicateAsset?.id,
      warning: processed.sizeDeviationWarning,
      sourceDimensions: processed.sourceDimensions,
      compressionRatio: ((1 - processed.byteSize / buffer.length) * 100).toFixed(1) + '%',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
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
  app.use(express.static(path.resolve(__dirname, 'public')));
  app.get('*', (_req, res) => {
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
