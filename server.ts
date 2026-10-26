/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { processFoodImage } from './src/lib/images/process-image';
import { buildVersionedStorageKey, getStorageProvider } from './src/lib/storage/image-storage';
import {
  initializeCatalog,
  getAllAssets,
  getAssetById,
  findAssetByHash,
  registerAsset,
  updateAssetStatus,
} from './src/lib/server/catalog-store';
import {
  initializeRestaurants,
  getAllRestaurants,
  getRestaurantMenu,
  updateMenuItemAssignment,
  handleAssetRevocation,
} from './src/lib/server/restaurant-store';
import { CANONICAL_DISHES } from './src/lib/catalog/canonical-dishes';
import { matchCanonicalDish } from './src/lib/catalog/matcher';
import { generateImportPreview, commitMenuImport } from './src/lib/import/menu-importer';
import type { AssetApprovalStatus, ImageAsset, LicenseType } from './src/lib/images/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure Multer for memory storage upload handling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
});

// Initialize Stores
await initializeCatalog();
initializeRestaurants();

// -------------------------------------------------------------
// Image Serving Route with Immutable CDN Caching Headers
// -------------------------------------------------------------
app.get('/api/images/food-assets/:assetId/:version/:filename', async (req, res) => {
  const { assetId, version, filename } = req.params;
  const storage = getStorageProvider();
  const key = `food-assets/${assetId}/${version}/${filename}`;

  try {
    const assetRecord = getAssetById(assetId);

    // If revoked, do not serve to customer requests
    if (assetRecord && assetRecord.approvalStatus === 'revoked') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.status(404).json({ error: 'Asset has been revoked for legal/licensing reasons.' });
      return;
    }

    const item = await storage.get(key);
    if (!item) {
      res.status(404).json({ error: 'Image asset not found.' });
      return;
    }

    // Set immutable CDN cache headers for versioned immutable assets
    res.setHeader('Content-Type', item.contentType || 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (assetRecord) {
      res.setHeader('ETag', `"${assetRecord.sha256Hash}"`);
    }

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

// Upload and process an image
app.post('/api/images/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No image file uploaded.' });
      return;
    }

    const {
      dishName,
      canonicalDishId,
      focalPointX,
      focalPointY,
      licenseType,
      licenseEvidence,
      requiredAttribution,
      sourceProvider,
      autoApprove,
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

    // Deduplication check: check if an identical image buffer hash already exists
    const duplicateAsset = findAssetByHash(processed.hash);
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const storageKey = buildVersionedStorageKey(assetId, 1);
    const storage = getStorageProvider();

    // Upload to versioned key
    const uploadResult = await storage.upload(storageKey, processed.buffer, 'image/webp');

    const now = new Date().toISOString();
    const newAsset: ImageAsset = {
      id: assetId,
      canonicalDishId: canonicalDishId || undefined,
      dishName: dishName || 'Uploaded Food Dish',
      storageKey,
      publicUrl: uploadResult.url,
      sha256Hash: processed.hash,
      width: processed.width,
      height: processed.height,
      format: 'webp',
      byteSize: processed.byteSize,
      sourceProvider: sourceProvider || 'Restaurant Upload',
      licenseType: (licenseType as LicenseType) || 'Custom-Commercial',
      licenseEvidence: licenseEvidence || 'Owner upload consent',
      requiredAttribution: requiredAttribution || undefined,
      processingVersion: 'v1',
      processingQuality: processed.qualityUsed,
      focalPoint: { x: fx, y: fy },
      approvalStatus: autoApprove === 'true' ? 'approved' : 'pending_review',
      createdAt: now,
      updatedAt: now,
      tags: [dishName ? dishName.toLowerCase() : 'custom-upload'],
    };

    // Check for canonical dish match
    const match = dishName ? matchCanonicalDish(dishName) : null;

    registerAsset(newAsset);

    res.status(201).json({
      asset: newAsset,
      canonicalMatch: match,
      isDeduplicated: Boolean(duplicateAsset),
      existingDuplicateId: duplicateAsset?.id,
      warning: processed.sizeDeviationWarning,
      sourceDimensions: processed.sourceDimensions,
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

    const duplicateAsset = findAssetByHash(processed.hash);
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const storageKey = buildVersionedStorageKey(assetId, 1);
    const storage = getStorageProvider();

    const uploadResult = await storage.upload(storageKey, processed.buffer, 'image/webp');
    const now = new Date().toISOString();

    const newAsset: ImageAsset = {
      id: assetId,
      canonicalDishId: canonicalDishId || undefined,
      dishName: dishName || 'Open Source Food Dish',
      storageKey,
      publicUrl: uploadResult.url,
      sha256Hash: processed.hash,
      width: processed.width,
      height: processed.height,
      format: 'webp',
      byteSize: processed.byteSize,
      sourceUrl: imageUrl,
      sourceProvider: sourceProvider || new URL(imageUrl).hostname,
      licenseType: (licenseType as LicenseType) || 'CC0',
      licenseEvidence: licenseEvidence || imageUrl,
      requiredAttribution: requiredAttribution || `Source: ${new URL(imageUrl).hostname}`,
      processingVersion: 'v1',
      processingQuality: processed.qualityUsed,
      focalPoint: { x: fx, y: fy },
      approvalStatus: 'approved',
      createdAt: now,
      updatedAt: now,
      tags: [dishName ? dishName.toLowerCase() : 'open-source-url'],
    };

    registerAsset(newAsset);
    const match = dishName ? matchCanonicalDish(dishName) : null;

    res.status(201).json({
      asset: newAsset,
      canonicalMatch: match,
      isDeduplicated: Boolean(duplicateAsset),
      existingDuplicateId: duplicateAsset?.id,
      warning: processed.sizeDeviationWarning,
      sourceDimensions: processed.sourceDimensions,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

// Update asset approval status (e.g. approved, rejected, revoked)
app.patch('/api/images/catalog/:id/status', (req, res) => {
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
  }

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
app.post('/api/restaurants/:id/import-commit', (req, res) => {
  try {
    const { previewItems, userOverrides, actor } = req.body;
    const result = commitMenuImport(req.params.id, previewItems, userOverrides || {}, actor);
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update single item image assignment manually
app.patch('/api/restaurants/:id/assignments/:itemId', (req, res) => {
  try {
    const { assetId, actor } = req.body;
    const item = updateMenuItemAssignment(req.params.id, req.params.itemId, assetId, actor);
    if (!item) {
      res.status(404).json({ error: 'Menu item or restaurant not found.' });
      return;
    }
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
  res.status(err.status || 500).json({ error: err.message || 'Internal API error' });
});

// -------------------------------------------------------------
// Vite Dev Server / Static File Serving
// -------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Acropin Server listening on http://0.0.0.0:${port}`);
});
