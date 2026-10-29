/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldCheck, X, Tag, CheckCircle2, Lock } from 'lucide-react';
import type { ImageAsset, AcropinMetadataTags } from '../lib/images/types';

interface MetadataInspectorModalProps {
  asset: ImageAsset;
  onClose: () => void;
}

export function MetadataInspectorModal({ asset, onClose }: MetadataInspectorModalProps) {
  const metadata: AcropinMetadataTags = asset.acropinMetadata || {
    publisher: 'Acropin Open Food Library',
    universalName: asset.universalName,
    cleanExif: true,
    schemaVersion: '2.0',
    variantsAvailable: [
      asset.thumbnailUrl ? '128x128' : '',
      '480x480',
      asset.retinaUrl ? '960x960' : '',
      asset.hiResUrl ? '1600x1600' : '',
    ].filter(Boolean),
    license: asset.licenseType || 'CC0',
    contributorGitHub: asset.contributorGitHub,
    dcoSignOff: asset.dcoSignOff,
    mlVerified: Boolean(asset.mlInspection?.antiCorruptionPassed),
    timestamp: asset.createdAt,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">Acropin Metadata Tag System</h3>
              <p className="text-xs text-slate-400">Sanitized & Standardized Food Asset Tagging</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* EXIF Clean Strip Banner */}
          <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-200">
              <span className="font-semibold text-emerald-100">Third-Party Metadata Stripped:</span> All camera model, GPS geolocation coordinates, personal EXIF tags, and external metadata have been cleanly removed by Sharp. The asset is stamped exclusively with Acropin standard tags.
            </div>
          </div>

          {/* Key-Value Tag Inspector */}
          <div className="bg-slate-950/60 rounded-xl border border-slate-800 p-4 font-mono text-xs space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/60 text-slate-400">
              <span>METADATA PROPERTY</span>
              <span>STANDARDIZED VALUE</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">publisher:</span>
              <span className="text-emerald-400 font-semibold">{metadata.publisher}</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">universalName:</span>
              <span className="text-amber-300 font-bold">{metadata.universalName}</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">schemaVersion:</span>
              <span className="text-slate-300">{metadata.schemaVersion}</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">cleanExif:</span>
              <span className="text-emerald-400 font-semibold">true (Sanitized)</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">variantsAvailable:</span>
              <span className="text-sky-400">{metadata.variantsAvailable.join(', ')}</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">encodingFormat:</span>
              <span className="text-slate-300">image/webp (sRGB Colorspace)</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">license:</span>
              <span className="text-indigo-400">{metadata.license}</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">mlVerified:</span>
              <span className={metadata.mlVerified ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {metadata.mlVerified ? 'PASSED (Anti-Corruption Validated)' : 'Unverified'}
              </span>
            </div>

            {metadata.contributorGitHub && (
              <div className="flex items-center justify-between text-slate-200">
                <span className="text-slate-400">contributor:</span>
                <span className="text-sky-300">@{metadata.contributorGitHub}</span>
              </div>
            )}

            {metadata.dcoSignOff && (
              <div className="pt-2 border-t border-slate-800/60">
                <span className="text-slate-400 block mb-1">dcoSignOff:</span>
                <span className="text-slate-300 text-[11px] block break-all bg-slate-900 p-2 rounded border border-slate-800">
                  {metadata.dcoSignOff}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-slate-200 pt-1">
              <span className="text-slate-400">sha256Hash:</span>
              <span className="text-slate-400 text-[11px] truncate max-w-[240px]">{asset.sha256Hash}</span>
            </div>

            <div className="flex items-center justify-between text-slate-200">
              <span className="text-slate-400">timestamp:</span>
              <span className="text-slate-400 text-[11px]">{metadata.timestamp}</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
