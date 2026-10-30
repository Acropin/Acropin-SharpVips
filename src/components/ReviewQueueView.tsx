/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  User,
  ExternalLink,
  Layers,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { ImageAsset } from '../lib/images/types';

interface ReviewQueueViewProps {
  pendingAssets: ImageAsset[];
  isLoading: boolean;
  onRefresh: () => void;
  onDecision: (id: string, decision: 'approve' | 'reject', reason?: string) => Promise<void>;
  onViewVariants: (asset: ImageAsset) => void;
}

export function ReviewQueueView({
  pendingAssets,
  isLoading,
  onRefresh,
  onDecision,
  onViewVariants,
}: ReviewQueueViewProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      await onDecision(id, 'approve');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    const reason = rejectionReasons[id] || 'Does not meet image library standards';
    try {
      await onDecision(id, 'reject', reason);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Clock className="w-5 h-5 text-sky-400" />
            Organizer Review & Verification Queue
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Review the selected license, contributor rights confirmation and image quality before publishing.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full bg-sky-950 border border-sky-800 text-sky-300 text-xs font-mono font-semibold">
            {pendingAssets.length} Awaiting Decision
          </span>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            title="Refresh queue"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {pendingAssets.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-60" />
          <h3 className="text-sm font-semibold text-slate-200">Review Queue is Clear!</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            No images are currently waiting for review. New submissions will appear here after their image and license details are checked.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {pendingAssets.map((asset) => {
            const isActing = processingId === asset.id;
            const ml = asset.mlInspection;

            return (
              <div
                key={asset.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row gap-5 items-start"
              >
                {/* Thumbnail & Variant preview */}
                <div className="shrink-0 flex flex-col items-center">
                  <img
                    src={asset.thumbnailUrl || asset.publicUrl}
                    alt={asset.dishName}
                    className="w-28 h-28 object-contain rounded-lg border border-slate-700 shadow-md"
                  />
                  <button
                    onClick={() => onViewVariants(asset)}
                    className="mt-2 text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Inspect {asset.acropinMetadata?.variantsAvailable.length ?? 2} Variants
                  </button>
                </div>

                {/* Details & Inspection */}
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm">{asset.dishName}</h4>
                      <div className="text-xs text-slate-400 font-mono">slug: {asset.universalName}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-sky-300 font-mono text-xs">
                        {(asset.byteSize / 1024).toFixed(1)} KB WebP
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs font-medium flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        Clean EXIF
                      </span>
                    </div>
                  </div>

                  {/* Image inspection status */}
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-mono text-[11px]">Image inspection:</span>
                      {ml?.antiCorruptionPassed ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1 text-right">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {ml.verificationLevel === 'vision-model'
                            ? 'Vision checks passed'
                            : 'Basic file checks passed; human review required'}
                        </span>
                      ) : (
                        <span className="text-amber-400 font-semibold flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {ml?.verificationLevel === 'vision-model' ? 'Vision checks flagged' : 'Basic file checks failed'}
                        </span>
                      )}
                    </div>
                    {ml && (
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-1">
                        <div>
                          <span className="text-slate-500">Vision result: </span>
                          <span className="text-slate-200">{ml.isFood === null ? 'Not evaluated' : ml.detectedDish}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Vision quality score: </span>
                          <span className="text-slate-200 font-mono font-bold">
                            {ml.qualityScore === undefined ? 'Not evaluated' : `${ml.qualityScore}/100`}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Contributor information */}
                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {asset.contributorGitHub && (
                      <span className="flex items-center gap-1 text-slate-300">
                        <User className="w-3 h-3 text-sky-400" />
                        Contributor: @{asset.contributorGitHub}
                      </span>
                    )}
                    <span>Submitted: {new Date(asset.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-300">
                    <div>License: <span className="font-medium text-slate-100">{asset.licenseType === 'CC0' ? 'CC0-1.0' : asset.licenseType}</span></div>
                    <div className="mt-1">Rights confirmation: <span className={asset.rightsAttested ? 'text-emerald-300' : 'text-rose-300'}>{asset.rightsAttested ? 'Contributor confirmed' : 'Missing'}</span></div>
                    {asset.requiredAttribution && <div className="mt-1 break-words">Attribution: {asset.requiredAttribution}</div>}
                    {asset.sourceUrl && <a className="mt-1 inline-block text-sky-300 hover:underline" href={asset.sourceUrl} target="_blank" rel="noreferrer">Open submitted image source</a>}
                  </div>
                </div>

                {/* Decision Actions */}
                <div className="shrink-0 flex flex-col gap-2 w-full md:w-48 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
                  <button
                    onClick={() => handleApprove(asset.id)}
                    disabled={isActing}
                    className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    {isActing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Approve to Database
                  </button>

                  <button
                    onClick={() => handleReject(asset.id)}
                    disabled={isActing}
                    className="w-full px-4 py-2 bg-slate-800 hover:bg-red-950 hover:text-red-300 text-slate-300 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 border border-slate-700 hover:border-red-800"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject Submission
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
