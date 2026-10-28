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
  HardDrive,
  Database
} from 'lucide-react';
import type { ImageAsset } from './lib/images/types';
import { toUniversalFoodName } from './lib/images/universal-naming';
import { apiFetch, requestAdminAccess } from './lib/client/api';

interface ProcessResponse {
  asset: ImageAsset;
  canonicalMatch?: {
    matchType: string;
    confidence: number;
    canonicalDish?: {
      canonicalName: string;
      cuisine: string;
      category: string;
      dietary: string;
    };
    reason: string;
  } | null;
  warning?: string;
  sourceDimensions?: { width: number; height: number };
  compressionRatio?: string;
}

// Preset open-source food image samples for instant 1-click testing
const OPEN_SOURCE_SAMPLES = [
  {
    title: 'Margherita Pizza',
    source: 'Unsplash / Open',
    url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=1000&auto=format&fit=crop&q=80',
    dish: 'Margherita Pizza',
  },
  {
    title: 'Cheeseburger',
    source: 'Unsplash / Open',
    url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1000&auto=format&fit=crop&q=80',
    dish: 'Classic Cheeseburger',
  },
  {
    title: 'Tonkotsu Ramen',
    source: 'Unsplash / Open',
    url: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=1000&auto=format&fit=crop&q=80',
    dish: 'Tonkotsu Ramen',
  },
  {
    title: 'Tiramisu',
    source: 'Unsplash / Open',
    url: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=1000&auto=format&fit=crop&q=80',
    dish: 'Classic Tiramisu',
  },
  {
    title: 'Paneer Butter Masala',
    source: 'Wikimedia / Open',
    url: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=1000&auto=format&fit=crop&q=80',
    dish: 'Paneer Butter Masala',
  },
];

const API_ACCESS_CONTACT_URL = import.meta.env.VITE_API_ACCESS_CONTACT_URL
  || 'mailto:manish.rathaur.dev@gmail.com?subject=Acropin%20Food%20Images%20API%20access';

export default function App() {
  const [activeTab, setActiveTab] = useState<'processor' | 'library'>('processor');
  const [inputMode, setInputMode] = useState<'upload' | 'url'>('upload');
  
  // File & URL state
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  
  // Naming state (standardized single universal name)
  const [dishTitle, setDishTitle] = useState<string>('');
  const [universalSlug, setUniversalSlug] = useState<string>('');
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState<boolean>(false);

  // Drag-and-drop state
  const [isWindowDragging, setIsWindowDragging] = useState<boolean>(false);
  const [isDropZoneOver, setIsDropZoneOver] = useState<boolean>(false);
  const dragCounter = useRef(0);

  // Focal point
  const [focalX, setFocalX] = useState<number>(0.5);
  const [focalY, setFocalY] = useState<number>(0.5);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Library / Collection state
  const [catalog, setCatalog] = useState<ImageAsset[]>([]);
  const [librarySearch, setLibrarySearch] = useState<string>('');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Auto-compute universal slug whenever dishTitle or file/URL changes (unless user manually typed custom slug)
  const deriveDefaultUniversalName = useCallback((raw: string) => {
    const derived = toUniversalFoodName(raw);
    return derived.universalName;
  }, []);

  const handleApplyRawName = useCallback((name: string) => {
    setDishTitle(name);
    if (!isSlugManuallyEdited) {
      setUniversalSlug(deriveDefaultUniversalName(name));
    }
  }, [deriveDefaultUniversalName, isSlugManuallyEdited]);

  // Load catalog library from backend
  const fetchCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    try {
      const res = await apiFetch('/api/images/catalog');
      const data = await safeParseJson(res);
      if (Array.isArray(data.assets)) {
        setCatalog(data.assets);
      }
    } catch (err) {
      console.error('Failed to load image library catalog:', err);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // Cleanup old service workers & caches
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) reg.unregister();
      });
    }
    if ('caches' in window) {
      caches.keys().then((names) => {
        for (const name of names) caches.delete(name);
      });
    }
  }, []);

  // Window drag-and-drop listener
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsWindowDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        setIsWindowDragging(false);
        dragCounter.current = 0;
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsWindowDragging(false);
      setIsDropZoneOver(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile.type.startsWith('image/')) {
          setInputMode('upload');
          setActiveTab('processor');
          handleSelectFile(droppedFile);
        } else {
          setError('Please drop a valid image file (JPEG, PNG, WebP).');
        }
      }
    };

    // Global Clipboard Paste listener
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;

      // 1. Check for image files in clipboard
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile();
          if (blob) {
            setInputMode('upload');
            setActiveTab('processor');
            handleSelectFile(blob);
            setError(null);
            return;
          }
        }
      }

      // 2. Check for URL in clipboard text if focused outside input
      const text = e.clipboardData.getData('text').trim();
      if (text.startsWith('http://') || text.startsWith('https://')) {
        // If image URL
        if (/\.(jpeg|jpg|png|webp|avif)/i.test(text) || text.includes('images.unsplash.com') || text.includes('upload.wikimedia.org')) {
          setInputMode('url');
          setActiveTab('processor');
          setImageUrl(text);
          setError(null);
          let extracted = 'Food Dish';
          try {
            const urlPath = new URL(text).pathname.split('/').pop() || '';
            extracted = urlPath.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '');
          } catch {
            // ignore
          }
          handleApplyRawName(extracted);
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
    };
  }, [handleApplyRawName]);

  const handleSelectFile = (selectedFile: File) => {
    setFile(selectedFile);
    setFilePreview(URL.createObjectURL(selectedFile));
    setError(null);

    const cleanRawName = selectedFile.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());

    handleApplyRawName(cleanRawName);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectFile(e.target.files[0]);
    }
  };

  const handleFocalClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocalX(Number(x.toFixed(2)));
    setFocalY(Number(y.toFixed(2)));
  };

  const safeParseJson = async (res: Response) => {
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      if (text.trim().startsWith('<')) {
        throw new Error(
          `Server returned an HTML error page (${res.status} ${res.statusText}). Please check that the server is running.`
        );
      }
      throw new Error(`Invalid server response (${res.status}): ${text.slice(0, 100)}`);
    }

    if (!res.ok) {
      throw new Error(json.error || `Server error (${res.status})`);
    }
    return json;
  };

  const handleProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsProcessing(true);

    // Compute final universal name to assign
    const chosenUniversalName = (universalSlug || deriveDefaultUniversalName(dishTitle || 'food-dish'))
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '');

    try {
      let data: ProcessResponse;

      if (inputMode === 'upload') {
        if (!file) throw new Error('Please select or drop an image file.');
        const formData = new FormData();
        formData.append('image', file);
        formData.append('dishName', dishTitle || chosenUniversalName);
        formData.append('universalName', chosenUniversalName);
        formData.append('focalPointX', focalX.toString());
        formData.append('focalPointY', focalY.toString());

        const res = await apiFetch('/api/images/upload', {
          method: 'POST',
          body: formData,
        });

        data = await safeParseJson(res);
      } else {
        if (!imageUrl || !imageUrl.startsWith('http')) {
          throw new Error('Please enter a valid HTTP or HTTPS image URL.');
        }

        const res = await apiFetch('/api/images/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl,
            dishName: dishTitle || chosenUniversalName,
            universalName: chosenUniversalName,
            focalPointX: focalX,
            focalPointY: focalY,
          }),
        });

        data = await safeParseJson(res);
      }

      setResult(data);
      // Immediately refresh collection library
      fetchCatalog();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteAsset = async (id: string) => {
    try {
      const res = await apiFetch(`/api/images/collection/${id}`, { method: 'DELETE' });
      await safeParseJson(res);
      setCatalog((prev) => prev.filter((a) => a.id !== id));
      if (result?.asset.id === id) {
        setResult(null);
      }
      setDeleteConfirmId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete asset.');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter library collection
  const filteredCatalog = catalog.filter((asset) => {
    if (!librarySearch) return true;
    const q = librarySearch.toLowerCase().trim();
    return (
      asset.dishName?.toLowerCase().includes(q) ||
      asset.universalName?.toLowerCase().includes(q) ||
      asset.filename?.toLowerCase().includes(q) ||
      asset.storageKey?.toLowerCase().includes(q)
    );
  });

  // Calculate library statistics
  const totalBytes = catalog.reduce((acc, cur) => acc + (cur.byteSize || 0), 0);
  const avgKb = catalog.length > 0 ? (totalBytes / 1024 / catalog.length).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Full-screen Drag Overlay */}
      {isWindowDragging && (
        <div className="fixed inset-0 z-50 bg-amber-600/90 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none transition-all animate-in fade-in">
          <div className="p-8 rounded-3xl bg-slate-950/90 border-2 border-amber-400 text-center shadow-2xl max-w-md mx-4">
            <Upload className="w-16 h-16 text-amber-400 mx-auto mb-4 animate-bounce" />
            <h2 className="text-2xl font-black text-white tracking-tight">Drop Food Image Here</h2>
            <p className="text-sm text-slate-300 mt-2">
              Instant 480 × 480 WebP conversion with automatic universal naming
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-900/40">
              <UtensilsCrossed className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-base tracking-tight text-white">
                  Acropin Food Image System
                </h1>
                <span className="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-300 font-mono rounded-full font-bold border border-amber-500/30">
                  Sharp + libvips
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Food image library with 480, 960, and source-supported 1600 px WebP sizes
              </p>
            </div>
          </div>

          {/* Navigation Pills */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('processor')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'processor'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Processor</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'library'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Image Library</span>
              <span className="ml-1 px-1.5 py-0.2 bg-slate-800 text-[10px] rounded-full text-amber-300 font-mono">
                {catalog.length}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Free API access for restaurant apps</h2>
            <p className="mt-1 text-xs text-slate-400">Contact the owner to request an approved API key. Keys are issued individually with usage limits.</p>
          </div>
          <a
            href={API_ACCESS_CONTACT_URL}
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-400"
          >
            Request free API access
          </a>
          <button
            type="button"
            onClick={() => {
              if (requestAdminAccess()) void fetchCatalog();
            }}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Owner dashboard
          </button>
        </section>
        {activeTab === 'processor' ? (
          <div className="space-y-8">
            {/* Primary Processing Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <FileImage className="w-5 h-5 text-amber-400" /> Process & Build Universal Library
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Drop any food photo or open-source image URL. Converts to exact 480 × 480 sRGB WebP with default universal single name.
                  </p>
                </div>

                {/* Input Mode Selector */}
                <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setInputMode('upload');
                      setError(null);
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      inputMode === 'upload'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" /> Drag & Drop / File
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInputMode('url');
                      setError(null);
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      inputMode === 'url'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <LinkIcon className="w-3.5 h-3.5" /> Image URL
                  </button>
                </div>
              </div>

              <form onSubmit={handleProcess} className="space-y-6">
                {/* Mode 1: Drag & Drop Zone */}
                {inputMode === 'upload' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">
                      Drop Food Image File or Click to Browse
                    </label>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDropZoneOver(true);
                      }}
                      onDragLeave={() => setIsDropZoneOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDropZoneOver(false);
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          handleSelectFile(e.dataTransfer.files[0]);
                        }
                      }}
                      className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition cursor-pointer ${
                        isDropZoneOver
                          ? 'border-amber-400 bg-amber-500/10 scale-[1.01]'
                          : file
                          ? 'border-emerald-500/50 bg-slate-950/70'
                          : 'border-slate-700 hover:border-amber-500/70 bg-slate-950/40'
                      }`}
                    >
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />

                      {file ? (
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                          {filePreview && (
                            <img
                              src={filePreview}
                              alt="Selected food preview"
                              className="w-20 h-20 rounded-xl object-cover border border-slate-700 shadow-md"
                            />
                          )}
                          <div className="text-left">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              <p className="text-sm font-bold text-white">{file.name}</p>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 font-mono">
                              {(file.size / 1024).toFixed(1)} KB • Ready for Sharp libvips 480×480 WebP crop
                            </p>
                            <span className="text-[11px] text-amber-400 underline mt-1 inline-block">
                              Click or drop another file to replace
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-amber-400 mb-3 shadow-inner">
                            <Upload className="w-6 h-6" />
                          </div>
                          <p className="text-sm font-bold text-white">
                            Drag & drop your food photo here, or <span className="text-amber-400 underline">browse</span>
                          </p>
                          <p className="text-xs text-slate-400 mt-1 max-w-sm">
                            Supports JPG, PNG, WebP. Tip: You can also press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-300 font-mono">Ctrl+V</kbd> anywhere to paste an image!
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Mode 2: Open Source Image URL */
                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-slate-300">
                      Open Source Food Image URL
                    </label>
                    <div className="relative">
                      <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        placeholder="https://images.unsplash.com/... or https://upload.wikimedia.org/..."
                        value={imageUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setImageUrl(val);
                          setError(null);
                          if (val && !dishTitle) {
                            try {
                              const pathName = new URL(val).pathname.split('/').pop() || '';
                              const extracted = pathName.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '');
                              handleApplyRawName(extracted);
                            } catch {
                              // ignore
                            }
                          }
                        }}
                        className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono text-xs"
                      />
                    </div>

                    {/* Quick 1-Click Samples */}
                    <div>
                      <span className="text-[11px] text-slate-400 block mb-1.5 font-medium">
                        Quick 1-Click Open-Source Samples:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {OPEN_SOURCE_SAMPLES.map((sample, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setImageUrl(sample.url);
                              handleApplyRawName(sample.dish);
                              setError(null);
                            }}
                            className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition border border-slate-800 flex items-center gap-1.5"
                          >
                            <span>{sample.title}</span>
                            <span className="text-[10px] text-slate-500">({sample.source})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Single Universal Name Box (Crucial User Requirement) */}
                <div className="bg-slate-950/80 border border-amber-500/30 rounded-2xl p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-white uppercase tracking-wider">
                        Single Standard Universal Name
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                      Standard Default Format
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Dish Title */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Dish Title (Human Readable)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Margherita Pizza, Classic Cheeseburger"
                        value={dishTitle}
                        onChange={(e) => handleApplyRawName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-medium"
                      />
                    </div>

                    {/* Universal Single Slug */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center justify-between">
                        <span>Universal Standard Identifier</span>
                        {isSlugManuallyEdited && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsSlugManuallyEdited(false);
                              setUniversalSlug(deriveDefaultUniversalName(dishTitle || 'food-dish'));
                            }}
                            className="text-[10px] text-amber-400 hover:underline"
                          >
                            Reset Auto
                          </button>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="e.g. margherita-pizza"
                          value={universalSlug || deriveDefaultUniversalName(dishTitle || 'food-dish')}
                          onChange={(e) => {
                            setIsSlugManuallyEdited(true);
                            setUniversalSlug(
                              e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9-]/g, '-')
                                .replace(/^-+|-+$/g, '')
                            );
                          }}
                          className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-amber-300 font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Standardized Default Format Preview Banner */}
                  <div className="mt-3 pt-3 border-t border-slate-900 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Default Target File:</span>
                      <span className="px-2 py-0.5 bg-amber-500/10 text-amber-300 font-mono font-bold rounded border border-amber-500/20">
                        {(universalSlug || deriveDefaultUniversalName(dishTitle || 'food-dish'))}.webp
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                      <span>Serving Key:</span>
                      <span className="text-slate-300 truncate max-w-xs">
                        food-assets/{(universalSlug || deriveDefaultUniversalName(dishTitle || 'food-dish'))}/480.webp
                      </span>
                    </div>
                  </div>
                </div>

                {/* Focal Point Adjuster */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-xs text-slate-400 hover:text-amber-400 font-medium flex items-center gap-1.5 transition"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>{showAdvanced ? 'Hide Crop Focal Point' : 'Adjust Crop Focal Point (Center Default 0.5, 0.5)'}</span>
                  </button>

                  {showAdvanced && (filePreview || imageUrl) && (
                    <div className="mt-3 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                        <span>Click on the dish focal center:</span>
                        <span className="font-mono text-amber-400">
                          X: {focalX.toFixed(2)}, Y: {focalY.toFixed(2)}
                        </span>
                      </div>
                      <div
                        onClick={handleFocalClick}
                        className="relative max-h-56 bg-black rounded-xl overflow-hidden cursor-crosshair flex items-center justify-center border border-slate-800"
                      >
                        <img
                          src={inputMode === 'upload' ? filePreview || '' : imageUrl}
                          alt="Crop target"
                          className="max-h-56 object-contain"
                        />
                        <div
                          className="absolute w-6 h-6 border-2 border-amber-400 bg-amber-400/20 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-lg"
                          style={{
                            left: `${focalX * 100}%`,
                            top: `${focalY * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="p-4 bg-rose-950/80 border border-rose-500/40 rounded-xl text-xs text-rose-300 font-medium flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Process Action Button */}
                <button
                  type="submit"
                  disabled={isProcessing || (inputMode === 'upload' && !file) || (inputMode === 'url' && !imageUrl)}
                  className="w-full py-4 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-50 text-white font-black rounded-2xl text-sm transition shadow-xl shadow-amber-900/30 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processing Real Food Image via Sharp...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Convert & Save as {(universalSlug || deriveDefaultUniversalName(dishTitle || 'food-dish'))}.webp</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Latest Processed Output Banner */}
            {result && (
              <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl">
                <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Processed & Saved to Library</h3>
                      <p className="text-xs text-slate-400">
                        Created exact 480 × 480 sRGB WebP with standard universal name.
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold rounded-full border border-emerald-500/30">
                    {result.asset.filename}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  {/* Real Image 480x480 Preview */}
                  <div className="flex flex-col items-center">
                    <div className="relative w-64 h-64 sm:w-72 sm:h-72 rounded-2xl overflow-hidden bg-black border-2 border-emerald-500/40 shadow-xl">
                      <img
                        src={result.asset.publicUrl}
                        alt={result.asset.dishName}
                        width={480}
                        height={480}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 right-2 bg-black/85 backdrop-blur-xs text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">
                        480 × 480 WebP
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 mt-2 font-mono">
                      {(result.asset.byteSize / 1024).toFixed(1)} KB • Quality: {result.asset.processingQuality}
                      {result.compressionRatio ? ` • Saved ${result.compressionRatio}` : ''}
                    </span>
                  </div>

                  {/* Metadata Specs */}
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2.5 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Universal Name:</span>
                        <span className="text-amber-400 font-bold">{result.asset.universalName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Standard File:</span>
                        <span className="text-emerald-400 font-bold">{result.asset.filename}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Dimensions:</span>
                        <span className="text-slate-200">480 × 480 px (Square)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Format & Color:</span>
                        <span className="text-slate-200">WebP (sRGB)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">File Byte Size:</span>
                        <span className="text-amber-400 font-bold">{(result.asset.byteSize / 1024).toFixed(1)} KB</span>
                      </div>
                      <div>
                        <span className="text-slate-500">SHA-256 Hash:</span>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">
                          {result.asset.sha256Hash}
                        </p>
                      </div>
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <a
                        href={result.asset.publicUrl}
                        download={result.asset.filename}
                        className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-amber-900/30"
                      >
                        <Download className="w-3.5 h-3.5" /> Download {result.asset.filename}
                      </a>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(result.asset.publicUrl, 'result_url')}
                        className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700"
                      >
                        {copiedId === 'result_url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedId === 'result_url' ? 'Copied URL!' : 'Copy URL'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const tag = `<img src="${result.asset.publicUrl}" alt="${result.asset.dishName}" width="480" height="480" loading="lazy" />`;
                          copyToClipboard(tag, 'result_tag');
                        }}
                        className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700"
                      >
                        {copiedId === 'result_tag' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Layers className="w-3.5 h-3.5" />}
                        <span>{copiedId === 'result_tag' ? 'Copied HTML!' : 'Copy <img>'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Centralized Food Image Library / Collection Manager */}
        {(activeTab === 'library' || activeTab === 'processor') && (
          <div className="mt-10">
            {/* Library Section Header */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-amber-400" />
                    <h2 className="text-lg font-bold text-white">Centralized Image Library Collection</h2>
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-xs font-mono rounded-full font-bold">
                      {catalog.length} {catalog.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    All processed food images stored with clean universal names for rapid re-use across menu items and restaurants.
                  </p>
                </div>

                {/* Library Stats */}
                <div className="flex items-center gap-4 bg-slate-950 p-2.5 px-4 rounded-2xl border border-slate-800 text-xs font-mono">
                  <div>
                    <span className="text-slate-500 block text-[10px]">AVG SIZE</span>
                    <span className="text-amber-400 font-bold">{avgKb} KB</span>
                  </div>
                  <div className="w-px h-6 bg-slate-800" />
                  <div>
                    <span className="text-slate-500 block text-[10px]">STORAGE</span>
                    <span className="text-emerald-400 font-bold">{(totalBytes / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              </div>

              {/* Search & Filter Bar */}
              <div className="flex flex-col sm:flex-row items-center gap-3 mb-6">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by universal name (e.g. margherita-pizza), dish name, or filename..."
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                {librarySearch && (
                  <button
                    type="button"
                    onClick={() => setLibrarySearch('')}
                    className="px-3 py-2 bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs transition"
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {/* Gallery Grid */}
              {isLoadingCatalog ? (
                <div className="p-12 text-center text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Loading library assets...</span>
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div className="p-12 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
                  <FolderHeart className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <h3 className="text-sm font-bold text-slate-300">
                    {librarySearch ? 'No matching images found' : 'Your collection is empty'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    {librarySearch
                      ? 'Try searching with another keyword or clear the search filter.'
                      : 'Upload an image above or click one of the open source samples to start building your library.'}
                  </p>
                  {!librarySearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('processor');
                        setInputMode('url');
                        setImageUrl(OPEN_SOURCE_SAMPLES[0].url);
                        handleApplyRawName(OPEN_SOURCE_SAMPLES[0].dish);
                      }}
                      className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Try Sample Image
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCatalog.map((asset) => (
                    <div
                      key={asset.id}
                      className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 flex flex-col justify-between transition group shadow-lg"
                    >
                      <div>
                        {/* Image Square Thumbnail */}
                        <div className="relative aspect-square rounded-xl overflow-hidden bg-black mb-3 border border-slate-800 group-hover:border-amber-500/50 transition">
                          <img
                            src={asset.publicUrl}
                            alt={asset.dishName}
                            loading="lazy"
                            width={480}
                            height={480}
                            className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                          />
                          <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-xs text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">
                            480 × 480
                          </div>
                          <div className="absolute bottom-2 left-2 bg-black/80 backdrop-blur-xs text-[10px] font-mono text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                            {(asset.byteSize / 1024).toFixed(1)} KB
                          </div>
                        </div>

                        {/* Title & Universal Name */}
                        <div>
                          <h4 className="text-sm font-bold text-white truncate" title={asset.dishName}>
                            {asset.dishName}
                          </h4>
                          <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-amber-400 truncate">
                            <span className="text-slate-500">File:</span>
                            <span className="font-semibold text-slate-200 truncate">{asset.filename || `${asset.universalName}.webp`}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500 truncate">
                            Universal: <span className="text-slate-400">{asset.universalName}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="mt-4 pt-3 border-t border-slate-900 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          {/* 1-Click Download with clean universal name */}
                          <a
                            href={asset.publicUrl}
                            download={asset.filename || `${asset.universalName}.webp`}
                            title="Download standard 480x480 WebP"
                            className="p-2 bg-slate-900 hover:bg-amber-600 text-slate-300 hover:text-white rounded-lg transition"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>

                          {/* Copy URL */}
                          <button
                            type="button"
                            onClick={() => copyToClipboard(asset.publicUrl, `card_url_${asset.id}`)}
                            title="Copy image URL"
                            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition"
                          >
                            {copiedId === `card_url_${asset.id}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Copy HTML tag */}
                          <button
                            type="button"
                            onClick={() => {
                              const tag = `<img src="${asset.publicUrl}" alt="${asset.dishName}" width="480" height="480" loading="lazy" />`;
                              copyToClipboard(tag, `card_tag_${asset.id}`);
                            }}
                            title="Copy <img> HTML tag"
                            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition"
                          >
                            {copiedId === `card_tag_${asset.id}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Layers className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Delete Asset */}
                        <div>
                          {deleteConfirmId === asset.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDeleteAsset(asset.id)}
                                className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold rounded transition"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-2 py-1 bg-slate-800 text-slate-400 hover:text-white text-[10px] rounded transition"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(asset.id)}
                              title="Delete from collection"
                              className="p-2 text-slate-600 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">Acropin Food Engine</span>
            <span>•</span>
            <span>Sharp 480×480 WebP Processing</span>
          </div>
          <div className="font-mono text-[11px] text-slate-600">
            Immutable CDN Caching • Single Universal Food Naming
          </div>
        </div>
      </footer>
    </div>
  );
}
