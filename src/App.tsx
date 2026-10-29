/// <reference types="vite/client" />

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  Link as LinkIcon,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Download,
  RefreshCw,
  Sliders,
  UtensilsCrossed,
  Check,
  Trash2,
  Search,
  Layers,
  FileImage,
  FolderHeart,
  Info,
  ArrowRight,
  Database,
  ShieldCheck,
  ShieldAlert,
  GitCommit,
  User,
  Table as TableIcon,
  Clock,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';
import type { ImageAsset, MlInspectionResult } from './lib/images/types';
import type { InventoryTableRow } from './lib/server/dataset-target-store';
import { toUniversalFoodName } from './lib/images/universal-naming';
import { apiFetch } from './lib/client/api';
import { InventoryExcelTable } from './components/InventoryExcelTable';
import { ReviewQueueView } from './components/ReviewQueueView';
import { MetadataInspectorModal } from './components/MetadataInspectorModal';
import { VariantPreviewModal } from './components/VariantPreviewModal';

interface ProcessResponse {
  asset: ImageAsset;
  warning?: string;
  sourceDimensions?: { width: number; height: number };
  compressionRatio?: string;
  mlInspection?: MlInspectionResult;
}

interface DatasetResponse {
  totalTargetDishes: number;
  completedCount: number;
  missingCount: number;
  pendingCount: number;
  coveragePercent: number;
  rows: InventoryTableRow[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'inventory' | 'processor' | 'queue' | 'assets'>('inventory');
  const [inputMode, setInputMode] = useState<'upload' | 'url'>('upload');

  // File & URL state
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');

  // Naming state (universal food slug)
  const [dishTitle, setDishTitle] = useState<string>('');
  const [universalSlug, setUniversalSlug] = useState<string>('');
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState<boolean>(false);

  // Contributor DCO & GitHub Sign-Off State
  const [contributorGitHub, setContributorGitHub] = useState<string>(() => {
    return localStorage.getItem('acropin_contributor_github') || 'acropin-contributor';
  });
  const [contributorDcoEmail, setContributorDcoEmail] = useState<string>(() => {
    return localStorage.getItem('acropin_contributor_email') || 'contributor@acropin.org';
  });
  const [submitDirect, setSubmitDirect] = useState<boolean>(false);

  // ML Pre-check state
  const [mlPreCheck, setMlPreCheck] = useState<MlInspectionResult | null>(null);
  const [isMlChecking, setIsMlChecking] = useState<boolean>(false);

  // Focal point
  const [focalX, setFocalX] = useState<number>(0.5);
  const [focalY, setFocalY] = useState<number>(0.5);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<ProcessResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inventory Table state
  const [datasetData, setDatasetData] = useState<DatasetResponse | null>(null);
  const [isLoadingDataset, setIsLoadingDataset] = useState<boolean>(false);

  // Review Queue state
  const [pendingAssets, setPendingAssets] = useState<ImageAsset[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState<boolean>(false);

  // Catalog Assets
  const [catalog, setCatalog] = useState<ImageAsset[]>([]);
  const [assetSearch, setAssetSearch] = useState<string>('');

  // Modals state
  const [inspectingAsset, setInspectingAsset] = useState<ImageAsset | null>(null);
  const [viewingVariantsAsset, setViewingVariantsAsset] = useState<ImageAsset | null>(null);

  // Drag and drop
  const [isDragOver, setIsDragOver] = useState(false);

  // Save contributor settings to localStorage
  useEffect(() => {
    if (contributorGitHub) localStorage.setItem('acropin_contributor_github', contributorGitHub);
    if (contributorDcoEmail) localStorage.setItem('acropin_contributor_email', contributorDcoEmail);
  }, [contributorGitHub, contributorDcoEmail]);

  // Load Inventory Dataset
  const fetchDataset = useCallback(async () => {
    setIsLoadingDataset(true);
    try {
      const res = await apiFetch('/api/dataset/targets');
      if (res.ok) {
        const data = await res.json();
        setDatasetData(data);
      }
    } catch (err) {
      console.error('Failed to load dataset targets:', err);
    } finally {
      setIsLoadingDataset(false);
    }
  }, []);

  // Load Review Queue
  const fetchReviewQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    try {
      const res = await apiFetch('/api/images/review-queue');
      if (res.ok) {
        const data = await res.json();
        setPendingAssets(data.pending || []);
      }
    } catch (err) {
      console.error('Failed to load review queue:', err);
    } finally {
      setIsLoadingQueue(false);
    }
  }, []);

  // Load Approved Catalog
  const fetchCatalog = useCallback(async () => {
    try {
      const res = await apiFetch('/api/images/catalog?status=approved');
      if (res.ok) {
        const data = await res.json();
        setCatalog(data.assets || []);
      }
    } catch (err) {
      console.error('Failed to load catalog:', err);
    }
  }, []);

  useEffect(() => {
    fetchDataset();
    fetchReviewQueue();
    fetchCatalog();
  }, [fetchDataset, fetchReviewQueue, fetchCatalog]);

  // Auto-generate universal slug on dishTitle change
  const handleDishTitleChange = (val: string) => {
    setDishTitle(val);
    if (!isSlugManuallyEdited) {
      setUniversalSlug(toUniversalFoodName(val).universalName);
    }
  };

  // Pre-load a dish from the Excel table into the processor
  const handleSelectForContribution = (row: InventoryTableRow) => {
    setDishTitle(row.name);
    setUniversalSlug(row.universalSlug);
    setIsSlugManuallyEdited(true);
    setLastResult(null);
    setErrorMessage(null);
    setActiveTab('processor');
  };

  // Drag and drop handling
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selected = e.dataTransfer.files[0];
      setFile(selected);
      setFilePreview(URL.createObjectURL(selected));
      setInputMode('upload');
      if (!dishTitle) {
        const rawName = selected.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        handleDishTitleChange(rawName);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      setFilePreview(URL.createObjectURL(selected));
      if (!dishTitle) {
        const rawName = selected.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        handleDishTitleChange(rawName);
      }
    }
  };

  // Pre-check ML when an image is ready
  const runPreCheck = async () => {
    if (!file && !imageUrl) return;
    setIsMlChecking(true);
    try {
      const formData = new FormData();
      if (file) formData.append('image', file);
      if (imageUrl) formData.append('imageUrl', imageUrl);
      formData.append('dishName', dishTitle || 'Food Item');
      formData.append('universalSlug', universalSlug);

      const res = await apiFetch('/api/ml/inspect', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setMlPreCheck(data.mlInspection);
      }
    } catch {
      // Non-blocking pre-check
    } finally {
      setIsMlChecking(false);
    }
  };

  // Process & Submit Image
  const handleProcessAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMode === 'upload' && !file) {
      setErrorMessage('Please drop or select an image file.');
      return;
    }
    if (inputMode === 'url' && !imageUrl.trim()) {
      setErrorMessage('Please enter an image URL.');
      return;
    }
    if (!dishTitle.trim()) {
      setErrorMessage('Please provide the food dish name.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setLastResult(null);

    try {
      let res: Response;
      if (inputMode === 'upload' && file) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('dishName', dishTitle);
        formData.append('universalName', universalSlug);
        formData.append('focalPointX', String(focalX));
        formData.append('focalPointY', String(focalY));
        formData.append('contributorGitHub', contributorGitHub);
        formData.append('contributorDcoEmail', contributorDcoEmail);
        formData.append('submitDirect', String(submitDirect));
        formData.append('licenseType', 'CC0');

        res = await apiFetch('/api/images/upload', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await apiFetch('/api/images/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl,
            dishName: dishTitle,
            universalName: universalSlug,
            focalPointX: focalX,
            focalPointY: focalY,
            contributorGitHub,
            contributorDcoEmail,
            submitDirect,
            licenseType: 'CC0',
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process image');
      }

      setLastResult(data);
      // Refresh inventory and queue
      fetchDataset();
      fetchReviewQueue();
      fetchCatalog();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Review Decision
  const handleReviewDecision = async (id: string, decision: 'approve' | 'reject', reason?: string) => {
    try {
      const res = await apiFetch(`/api/images/review-queue/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, rejectionReason: reason }),
      });
      if (res.ok) {
        fetchDataset();
        fetchReviewQueue();
        fetchCatalog();
      }
    } catch (err) {
      console.error('Failed to record review decision:', err);
    }
  };

  // Delete Target Dish
  const handleDeleteTarget = async (id: string) => {
    if (!confirm('Are you sure you want to remove this dish target from the inventory?')) return;
    try {
      const res = await apiFetch(`/api/dataset/targets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchDataset();
      }
    } catch (err) {
      console.error('Failed to delete target:', err);
    }
  };

  // Import CSV or Excel Data
  const handleImportCsvOrExcel = async (rawText: string) => {
    const res = await apiFetch('/api/dataset/targets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText }),
    });
    if (res.ok) {
      fetchDataset();
    }
  };

  // Add Target Dish
  const handleAddTargetDish = async (name: string, category: string, dietary: string) => {
    const res = await apiFetch('/api/dataset/targets/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, dietary }),
    });
    if (res.ok) {
      fetchDataset();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-sky-500 flex items-center justify-center text-white shadow-md">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base text-slate-100 tracking-tight">Acropin</h1>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-semibold">
                  Universal Food Library
                </span>
              </div>
              <p className="text-xs text-slate-400">Excel-Grade Food Image Inventory & Multi-Tier Sharp Processor</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'inventory'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Excel Inventory</span>
            </button>

            <button
              onClick={() => setActiveTab('processor')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'processor'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Process & Contribute</span>
            </button>

            <button
              onClick={() => setActiveTab('queue')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'queue'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Review Queue</span>
              {pendingAssets.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">
                  {pendingAssets.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('assets')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'assets'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Catalog Assets ({catalog.length})</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* TAB 1: EXCEL-LIKE SPREADSHEET INVENTORY */}
        {activeTab === 'inventory' && (
          <InventoryExcelTable
            rows={datasetData?.rows || []}
            totalCount={datasetData?.totalTargetDishes || 0}
            completedCount={datasetData?.completedCount || 0}
            missingCount={datasetData?.missingCount || 0}
            pendingCount={datasetData?.pendingCount || 0}
            coveragePercent={datasetData?.coveragePercent || 0}
            isLoading={isLoadingDataset}
            onRefresh={fetchDataset}
            onSelectForContribution={handleSelectForContribution}
            onInspectMetadata={(asset) => setInspectingAsset(asset)}
            onViewVariants={(asset) => setViewingVariantsAsset(asset)}
            onDeleteTarget={handleDeleteTarget}
            onImportCsvOrExcel={handleImportCsvOrExcel}
            onAddTargetDish={handleAddTargetDish}
          />
        )}

        {/* TAB 2: IMAGE PROCESSOR & CONTRIBUTOR DROP ZONE */}
        {activeTab === 'processor' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-sky-400" />
                    Food Image Processing & Clean Metadata Stamper
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Converts any food image into 4 standard WebP variants (128px, 480px, 960px, 1600px), cleanly strips all external EXIF/camera metadata, and embeds Acropin universal tags.
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                  <button
                    onClick={() => setInputMode('upload')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      inputMode === 'upload' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                    }`}
                  >
                    Upload / Drop
                  </button>
                  <button
                    onClick={() => setInputMode('url')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      inputMode === 'url' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                    }`}
                  >
                    Image URL
                  </button>
                </div>
              </div>

              <form onSubmit={handleProcessAndSubmit} className="space-y-5">
                {/* File Drop Zone or URL Input */}
                {inputMode === 'upload' ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                      isDragOver
                        ? 'border-sky-400 bg-sky-950/20'
                        : file
                        ? 'border-emerald-500/50 bg-emerald-950/10'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                    }`}
                  >
                    {filePreview ? (
                      <div className="flex flex-col items-center gap-3">
                        <img
                          src={filePreview}
                          alt="Preview"
                          className="w-32 h-32 object-cover rounded-xl shadow-lg border border-slate-700"
                        />
                        <div className="text-xs text-slate-300">
                          <span className="font-semibold text-emerald-400">{file?.name}</span> (
                          {file ? (file.size / 1024).toFixed(1) : 0} KB)
                        </div>
                        <label className="cursor-pointer text-xs text-sky-400 hover:text-sky-300 underline font-medium">
                          Choose different file
                          <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                        </label>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                          <Upload className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-200">
                            Drag and drop food image here, or{' '}
                            <label className="text-sky-400 hover:text-sky-300 underline cursor-pointer">
                              browse files
                              <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                            </label>
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Supports JPEG, PNG, WebP, AVIF, TIFF up to 15 MB. Generated from ChatGPT/DALL-E or open-source.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Open-Source Image URL *</label>
                    <div className="relative">
                      <LinkIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        placeholder="https://example.com/food-dish.jpg"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500"
                      />
                    </div>
                  </div>
                )}

                {/* Dish Name & Universal Identifier */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Standard Dish Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Margherita Pizza"
                      value={dishTitle}
                      onChange={(e) => handleDishTitleChange(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Universal Identifier Slug (Auto-Derived)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        value={universalSlug}
                        onChange={(e) => {
                          setUniversalSlug(e.target.value);
                          setIsSlugManuallyEdited(true);
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 focus:outline-hidden focus:border-sky-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Contributor DCO & Sign-Off */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                    <span className="flex items-center gap-1.5 text-slate-200">
                      <User className="w-4 h-4 text-sky-400" />
                      Contributor Identity & Developer Certificate of Origin (DCO)
                    </span>
                    <span className="text-[11px] text-emerald-400 font-mono">Clean EXIF Guarantee</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">GitHub Username</label>
                      <input
                        type="text"
                        value={contributorGitHub}
                        onChange={(e) => setContributorGitHub(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">DCO Sign-Off Email</label>
                      <input
                        type="email"
                        value={contributorDcoEmail}
                        onChange={(e) => setContributorDcoEmail(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Submission target choice */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={submitDirect}
                        onChange={(e) => setSubmitDirect(e.target.checked)}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                      />
                      <span>Direct Commit (Organizer/Admin direct publish to active database)</span>
                    </label>
                    <span className="text-[11px] text-slate-500">
                      {submitDirect ? 'Immediate live status' : 'Enters Review Queue'}
                    </span>
                  </div>
                </div>

                {errorMessage && (
                  <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-xs text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Submit Button */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-sky-950/50 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Generating 4 Variants & Sanitizing EXIF...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>{submitDirect ? 'Process & Direct Commit' : 'Process & Submit to Review Queue'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Last Processing Result Card */}
            {lastResult && (
              <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-6 shadow-xl animate-in fade-in duration-200 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Image Successfully Processed into 4 Standard WebP Variants!</span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    Status:{' '}
                    <span className={lastResult.asset.approvalStatus === 'approved' ? 'text-emerald-400 font-bold' : 'text-sky-400 font-bold'}>
                      {lastResult.asset.approvalStatus.toUpperCase()}
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col items-center justify-center bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <img
                      src={lastResult.asset.thumbnailUrl || lastResult.asset.publicUrl}
                      alt={lastResult.asset.dishName}
                      className="w-32 h-32 object-contain rounded-lg shadow"
                    />
                    <div className="mt-2 text-xs font-mono text-slate-400 text-center">
                      Primary 480×480 WebP • {(lastResult.asset.byteSize / 1024).toFixed(1)} KB
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-2 text-xs">
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                      <div className="font-semibold text-slate-200">Generated Hierarchy Variants:</div>
                      <div className="text-slate-400 text-[11px] grid grid-cols-2 gap-2 pt-1 font-mono">
                        <div>• 128×128 (Thumbnail): {lastResult.asset.thumbnailByteSize ? (lastResult.asset.thumbnailByteSize / 1024).toFixed(1) : '—'} KB</div>
                        <div>• 480×480 (Card): {(lastResult.asset.byteSize / 1024).toFixed(1)} KB</div>
                        <div>• 960×960 (Retina 2x): {lastResult.asset.retinaByteSize ? (lastResult.asset.retinaByteSize / 1024).toFixed(1) : '—'} KB</div>
                        <div>• 1600×1600 (Hi-Res): {lastResult.asset.hiResByteSize ? (lastResult.asset.hiResByteSize / 1024).toFixed(1) : '—'} KB</div>
                      </div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between">
                      <span className="text-slate-300">Clean EXIF & Acropin Metadata Tags:</span>
                      <button
                        onClick={() => setInspectingAsset(lastResult.asset)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sky-400 text-[11px] font-medium"
                      >
                        Inspect Tags
                      </button>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setViewingVariantsAsset(lastResult.asset)}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium"
                      >
                        Inspect & Download 4 Sizes
                      </button>
                      <button
                        onClick={() => setActiveTab('inventory')}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs"
                      >
                        Return to Excel Table
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ORGANIZER REVIEW QUEUE */}
        {activeTab === 'queue' && (
          <ReviewQueueView
            pendingAssets={pendingAssets}
            isLoading={isLoadingQueue}
            onRefresh={fetchReviewQueue}
            onDecision={handleReviewDecision}
            onViewVariants={(asset) => setViewingVariantsAsset(asset)}
          />
        )}

        {/* TAB 4: CATALOG ASSETS GALLERY */}
        {activeTab === 'assets' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-100">Live Food Image Asset Library</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  High-fidelity WebP food assets delivered with immutable CDN caching headers.
                </p>
              </div>
              <div className="relative w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter library..."
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {catalog
                .filter((a) => !assetSearch || a.dishName.toLowerCase().includes(assetSearch.toLowerCase()))
                .map((asset) => (
                  <div
                    key={asset.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all group"
                  >
                    <div className="relative aspect-square bg-slate-950 overflow-hidden">
                      <img
                        src={asset.thumbnailUrl || asset.publicUrl}
                        alt={asset.dishName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <button
                        onClick={() => setViewingVariantsAsset(asset)}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-medium transition-opacity gap-1"
                      >
                        <Eye className="w-4 h-4" />
                        4 Sizes
                      </button>
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="font-semibold text-slate-100 text-xs truncate" title={asset.dishName}>
                        {asset.dishName}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{asset.universalName}</div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                        <span>{(asset.byteSize / 1024).toFixed(1)} KB</span>
                        <button
                          onClick={() => setInspectingAsset(asset)}
                          className="text-sky-400 hover:text-sky-300"
                          title="Inspect metadata tags"
                        >
                          Tags
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </main>

      {/* MODALS */}
      {inspectingAsset && (
        <MetadataInspectorModal asset={inspectingAsset} onClose={() => setInspectingAsset(null)} />
      )}

      {viewingVariantsAsset && (
        <VariantPreviewModal asset={viewingVariantsAsset} onClose={() => setViewingVariantsAsset(null)} />
      )}
    </div>
  );
}
