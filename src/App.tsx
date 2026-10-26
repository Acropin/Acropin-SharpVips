/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  Hash,
  Sliders,
  ShieldCheck,
  UtensilsCrossed,
  Check,
  ArrowRight
} from 'lucide-react';
import type { ImageAsset } from './lib/images/types';

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
}

// Preset open-source food image samples for instant 1-click testing
const OPEN_SOURCE_SAMPLES = [
  {
    title: 'Pizza Margherita (Wikimedia Commons)',
    url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=1000&auto=format&fit=crop&q=80',
    dish: 'Margherita Pizza',
  },
  {
    title: 'Classic Cheeseburger (Unsplash)',
    url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1000&auto=format&fit=crop&q=80',
    dish: 'Classic Cheeseburger',
  },
  {
    title: 'Japanese Ramen (Unsplash)',
    url: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=1000&auto=format&fit=crop&q=80',
    dish: 'Tonkotsu Ramen',
  },
  {
    title: 'Tiramisu Dessert (Unsplash)',
    url: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=1000&auto=format&fit=crop&q=80',
    dish: 'Classic Tiramisu',
  },
];

export default function App() {
  const [inputMode, setInputMode] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [dishName, setDishName] = useState<string>('');

  // Focal point
  const [focalX, setFocalX] = useState<number>(0.5);
  const [focalY, setFocalY] = useState<number>(0.5);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [history, setHistory] = useState<ImageAsset[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      setFilePreview(URL.createObjectURL(selected));
      setError(null);
      if (!dishName) {
        const cleanName = selected.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
        setDishName(cleanName);
      }
    }
  };

  const handleFocalClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocalX(Number(x.toFixed(2)));
    setFocalY(Number(y.toFixed(2)));
  };

  // Ensure legacy service workers and caches are purged
  React.useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          reg.unregister();
        }
      });
    }
    if ('caches' in window) {
      caches.keys().then((names) => {
        for (const name of names) {
          caches.delete(name);
        }
      });
    }
  }, []);

  const safeParseJson = async (res: Response) => {
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      if (text.trim().startsWith('<')) {
        throw new Error(
          `Server returned an HTML error page (${res.status} ${res.statusText}). Please check that the server is running and the URL is reachable.`
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

    try {
      let data: ProcessResponse;

      if (inputMode === 'upload') {
        if (!file) throw new Error('Please select an image file to upload.');
        const formData = new FormData();
        formData.append('image', file);
        formData.append('dishName', dishName || 'Food Item');
        formData.append('focalPointX', focalX.toString());
        formData.append('focalPointY', focalY.toString());
        formData.append('autoApprove', 'true');

        const res = await fetch('/api/images/upload', {
          method: 'POST',
          body: formData,
        });

        data = await safeParseJson(res);
      } else {
        if (!imageUrl || !imageUrl.startsWith('http')) {
          throw new Error('Please enter a valid HTTP or HTTPS image URL.');
        }

        const res = await fetch('/api/images/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl,
            dishName: dishName || 'Open Source Dish',
            focalPointX: focalX,
            focalPointY: focalY,
          }),
        });

        data = await safeParseJson(res);
      }

      setResult(data);
      setHistory((prev) => [data.asset, ...prev.filter((a) => a.id !== data.asset.id)]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    const fullUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-900/30">
              <UtensilsCrossed className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight text-white flex items-center gap-2">
                Acropin Food Image Processor
                <span className="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-300 font-mono rounded-full font-semibold">
                  Sharp + libvips
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Automated 480 × 480 WebP conversion, focal crop & dish matching
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* Processing Form Box */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl mb-8">
          {/* Mode Switcher Tabs */}
          <div className="flex items-center gap-2 p-1 bg-slate-950 rounded-2xl border border-slate-800 max-w-md mx-auto mb-6">
            <button
              type="button"
              onClick={() => {
                setInputMode('upload');
                setError(null);
              }}
              className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                inputMode === 'upload'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-900/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Upload className="w-4 h-4" /> Upload Local File
            </button>
            <button
              type="button"
              onClick={() => {
                setInputMode('url');
                setError(null);
              }}
              className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                inputMode === 'url'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-900/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LinkIcon className="w-4 h-4" /> Open Source Image URL
            </button>
          </div>

          <form onSubmit={handleProcess} className="space-y-6">
            {/* Input Mode 1: File Upload */}
            {inputMode === 'upload' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Food Photo (JPG, PNG, WebP)
                </label>
                <div className="border-2 border-dashed border-slate-700 hover:border-amber-500 rounded-2xl p-6 text-center bg-slate-950/60 transition cursor-pointer relative">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {file ? (
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-white">{file.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {(file.size / 1024).toFixed(1)} KB • Ready for Sharp processing
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Upload className="w-10 h-10 text-slate-500 mb-3" />
                      <p className="text-sm font-medium text-slate-200">
                        Drop an image here or <span className="text-amber-400 underline">browse</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        High resolution supported. Will be cropped square and optimized to 480×480 WebP.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Input Mode 2: Open Source Image URL */}
            {inputMode === 'url' && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  Open Source Image URL
                </label>
                <div className="relative">
                  <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    placeholder="https://images.unsplash.com/... or https://upload.wikimedia.org/..."
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value);
                      setError(null);
                    }}
                    className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Quick 1-Click Samples */}
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1.5 font-medium">
                    Or try these open source food images:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {OPEN_SOURCE_SAMPLES.map((sample, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setImageUrl(sample.url);
                          setDishName(sample.dish);
                          setError(null);
                        }}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition border border-slate-700"
                      >
                        {sample.title}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Dish Name Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Dish Name (Optional — for intelligent catalog matching)
              </label>
              <input
                type="text"
                placeholder="e.g. Margherita Pizza, Paneer Butter Masala, Cheeseburger"
                value={dishName}
                onChange={(e) => setDishName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Focal Point Picker (Toggleable) */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{showAdvanced ? 'Hide Crop Focal Point' : 'Adjust Crop Focal Point (Center Default)'}</span>
              </button>

              {showAdvanced && (filePreview || imageUrl) && (
                <div className="mt-3 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span>Click on the focal center of the dish:</span>
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
                <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isProcessing || (inputMode === 'upload' && !file) || (inputMode === 'url' && !imageUrl)}
              className="w-full py-3.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-50 text-white font-bold rounded-2xl text-sm transition shadow-xl shadow-amber-900/30 flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Processing with Sharp Engine...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Process & Convert to 480×480 WebP
                </>
              )}
            </button>
          </form>
        </div>

        {/* Processed Result Card */}
        {result && (
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl mb-8">
            <div className="flex items-center gap-2.5 text-emerald-400 mb-6 pb-4 border-b border-slate-800">
              <CheckCircle2 className="w-6 h-6" />
              <div>
                <h2 className="text-lg font-bold text-white">Image Processed Successfully</h2>
                <p className="text-xs text-slate-400">
                  Standardized 480 × 480 WebP generated and saved to versioned storage.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mb-6">
              {/* Output Image Preview with Exact 480x480 Display */}
              <div className="flex flex-col items-center">
                <div className="relative w-64 h-64 sm:w-72 sm:h-72 rounded-2xl overflow-hidden bg-black border-2 border-amber-500/50 shadow-xl">
                  <img
                    src={result.asset.publicUrl}
                    alt={result.asset.dishName}
                    width={480}
                    height={480}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-xs text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    480 × 480 WebP
                  </div>
                </div>
                <span className="text-xs text-slate-400 mt-2 font-mono">
                  {(result.asset.byteSize / 1024).toFixed(1)} KB • Quality: {result.asset.processingQuality}
                </span>
              </div>

              {/* Verified Metrics & Details */}
              <div className="space-y-4">
                {/* Canonical Match Banner */}
                {result.canonicalMatch?.canonicalDish ? (
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-amber-400 font-semibold flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Canonical Match
                      </span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {(result.canonicalMatch.confidence * 100).toFixed(0)}% Confidence
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white">
                      {result.canonicalMatch.canonicalDish.canonicalName}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {result.canonicalMatch.canonicalDish.cuisine} •{' '}
                      {result.canonicalMatch.canonicalDish.category} •{' '}
                      <span className="uppercase text-slate-300 font-semibold">
                        {result.canonicalMatch.canonicalDish.dietary}
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400">
                    Custom dish title: <strong className="text-white">{result.asset.dishName}</strong>
                  </div>
                )}

                {/* Specs Box */}
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Output Dimensions:</span>
                    <span className="text-slate-200">480 × 480 px (Square)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Output Format:</span>
                    <span className="text-emerald-400">WebP (sRGB)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">File Byte Size:</span>
                    <span className="text-amber-400">{(result.asset.byteSize / 1024).toFixed(1)} KB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Target Range (15-40KB):</span>
                    <span className="text-emerald-400 font-bold">
                      {result.asset.byteSize >= 15 * 1024 && result.asset.byteSize <= 40 * 1024
                        ? 'Optimized In-Range'
                        : 'Visual Quality Preserved'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">SHA-256 Checksum:</span>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {result.asset.sha256Hash}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Storage Key:</span>
                    <p className="text-[10px] text-slate-300 truncate mt-0.5">
                      {result.asset.storageKey}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <a
                    href={result.asset.publicUrl}
                    download={`${result.asset.dishName.replace(/\s+/g, '_')}_480.webp`}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-amber-900/30"
                  >
                    <Download className="w-3.5 h-3.5" /> Download 480x480 WebP
                  </a>
                  <button
                    onClick={() => handleCopyUrl(result.asset.publicUrl)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUrl ? 'Copied!' : 'Copy Asset URL'}</span>
                  </button>
                  <a
                    href={result.asset.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl text-xs transition flex items-center gap-1 border border-slate-700"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Gallery of Processed Assets */}
        {history.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" /> Processed In This Session ({history.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {history.map((asset) => (
                <div
                  key={asset.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-2 flex flex-col justify-between"
                >
                  <div className="aspect-square rounded-xl overflow-hidden bg-black mb-2 relative">
                    <img
                      src={asset.publicUrl}
                      alt={asset.dishName}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-1.5 right-1.5 bg-black/75 px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-300">
                      {(asset.byteSize / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white truncate">{asset.dishName}</h4>
                    <span className="text-[10px] text-emerald-400 block font-mono">
                      480x480 • WebP
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
