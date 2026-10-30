/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Download, Copy, Check, ExternalLink, Image as ImageIcon, Layers } from 'lucide-react';
import type { ImageAsset } from '../lib/images/types';

interface VariantPreviewModalProps {
  asset: ImageAsset;
  onClose: () => void;
}

export function VariantPreviewModal({ asset, onClose }: VariantPreviewModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<'128' | '480' | '960' | '1600'>('480');
  const [selectedFormat, setSelectedFormat] = useState<'webp' | 'avif' | 'jpeg' | 'png'>('webp');

  const urlForVariant = (url: string, maxEdge: number): string => {
    if (asset.processingVersion !== 'v3-on-demand') return url;
    const parsed = new URL(url, 'https://acropin.invalid');
    parsed.searchParams.set('width', String(maxEdge));
    parsed.searchParams.set('height', String(maxEdge));
    parsed.searchParams.set('format', selectedFormat);
    return `${parsed.pathname}${parsed.search}`;
  };

  const variantCandidates = [
    {
      key: '128' as const,
      width: asset.thumbnailWidth ?? 128,
      height: asset.thumbnailHeight ?? 128,
      maxEdge: 128,
      desc: 'Small preview',
      url: asset.thumbnailUrl,
      sizeKb: asset.processingVersion === 'v3-on-demand' ? undefined : asset.thumbnailByteSize ? (asset.thumbnailByteSize / 1024).toFixed(1) : undefined,
    },
    {
      key: '480' as const,
      width: asset.width,
      height: asset.height,
      maxEdge: 480,
      desc: 'Standard menu image',
      url: asset.publicUrl,
      sizeKb: asset.processingVersion === 'v3-on-demand' ? undefined : (asset.byteSize / 1024).toFixed(1),
    },
    {
      key: '960' as const,
      width: asset.retinaWidth ?? 960,
      height: asset.retinaHeight ?? 960,
      maxEdge: 960,
      desc: 'High-density display',
      url: asset.retinaUrl,
      sizeKb: asset.processingVersion === 'v3-on-demand' ? undefined : asset.retinaByteSize ? (asset.retinaByteSize / 1024).toFixed(1) : undefined,
    },
    {
      key: '1600' as const,
      width: asset.hiResWidth ?? 1600,
      height: asset.hiResHeight ?? 1600,
      maxEdge: 1600,
      desc: 'High-resolution display',
      url: asset.hiResUrl,
      sizeKb: asset.processingVersion === 'v3-on-demand' ? undefined : asset.hiResByteSize ? (asset.hiResByteSize / 1024).toFixed(1) : undefined,
    },
  ];
  const variants = variantCandidates.filter(
    (variant): variant is (typeof variantCandidates)[number] & { url: string } => typeof variant.url === 'string'
  );

  const current = variants.find((variant) => variant.key === selectedVariant) ?? variants.find((variant) => variant.key === '480')!;
  const currentUrl = urlForVariant(current.url, current.maxEdge);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(new URL(text, window.location.origin).toString());
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">{asset.dishName}</h3>
              <p className="text-xs text-slate-400 font-mono">universal slug: {asset.universalName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Active Variant Image Preview */}
          <div className="flex flex-col items-center justify-center bg-slate-950 rounded-xl p-4 border border-slate-800 min-h-[300px]">
            <img
              src={currentUrl}
              alt={`${asset.dishName} ${current.width}×${current.height}`}
              className="max-h-[260px] max-w-full object-contain rounded-lg shadow-lg"
            />
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span className="text-sky-400 font-semibold">{current.width}×{current.height} px</span>
              {current.sizeKb && <span>• {current.sizeKb} KB</span>}
              <span>• {selectedFormat.toUpperCase()} sRGB</span>
            </div>
          </div>

          {/* Right: 4-Variant Selector & Action Cards */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
              Available full-frame variants (maximum edge)
            </div>

            {asset.processingVersion === 'v3-on-demand' && (
              <label className="block text-xs text-slate-400">
                Download format
                <select
                  value={selectedFormat}
                  onChange={(event) => setSelectedFormat(event.target.value as typeof selectedFormat)}
                  className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
                >
                  <option value="webp">WebP · web balance</option>
                  <option value="avif">AVIF · smaller files</option>
                  <option value="jpeg">JPEG · compatibility</option>
                  <option value="png">PNG · lossless</option>
                </select>
              </label>
            )}

            <div className="space-y-2">
              {variants.map((variant) => {
                const isSelected = selectedVariant === variant.key;
                const isCopied = copiedKey === variant.key;
                return (
                  <div
                    key={variant.key}
                    onClick={() => setSelectedVariant(variant.key)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-sky-950/40 border-sky-500/50 shadow-xs'
                        : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold font-mono ${isSelected ? 'text-sky-300' : 'text-slate-200'}`}>
                          {variant.width}×{variant.height} px
                        </span>
                        {variant.sizeKb && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-mono">
                            {variant.sizeKb} KB
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{variant.desc} · max edge {variant.maxEdge}px</div>
                    </div>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleCopy(urlForVariant(variant.url, variant.maxEdge), variant.key)}
                        title="Copy image URL"
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <a
                        href={urlForVariant(variant.url, variant.maxEdge)}
                        download={`${asset.universalName}-${variant.key}.${selectedFormat}`}
                        title={`Download ${selectedFormat.toUpperCase()}`}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Direct CDN Link Copy Box */}
            <div className="pt-2">
            <label className="text-[11px] text-slate-400 font-mono block mb-1">Image URL ({current.width}×{current.height} px):</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={new URL(currentUrl, window.location.origin).toString()}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono select-all focus:outline-hidden"
                />
                <button
                  onClick={() => handleCopy(currentUrl, 'url-input')}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition-colors shrink-0 flex items-center gap-1"
                >
                  {copiedKey === 'url-input' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/40 flex justify-between items-center text-xs text-slate-400">
          <div>Licensed under {asset.licenseType} • EXIF metadata sanitized</div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
