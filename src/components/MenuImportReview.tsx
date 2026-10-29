/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  FileCode,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Sparkles,
  HelpCircle,
  Eye,
  RefreshCw,
  Check,
  ChevronRight,
  ShieldCheck,
  UtensilsCrossed,
  Info
} from 'lucide-react';
import type { ImageAsset, ImportPreviewItem, ImportSummary } from '../lib/images/types';
import { apiFetch } from '../lib/client/api';

interface MenuImportReviewProps {
  currentRestaurantId: string;
  onImportComplete?: () => void;
}



export const MenuImportReview: React.FC<MenuImportReviewProps> = ({
  currentRestaurantId,
  onImportComplete,
}) => {
  const [jsonText, setJsonText] = useState('');
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[] | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryReport, setSummaryReport] = useState<ImportSummary | null>(null);

  // Manual Override Modal
  const [activeOverrideItem, setActiveOverrideItem] = useState<ImportPreviewItem | null>(null);
  const [approvedAssets, setApprovedAssets] = useState<ImageAsset[]>([]);
  const [userOverrides, setUserOverrides] = useState<Record<string, string | null>>({});

  useEffect(() => {
    apiFetch('/api/images/catalog?status=approved')
      .then((r) => r.json())
      .then((d) => setApprovedAssets(d.assets || []))
      .catch(console.error);
  }, []);

  const handleRunPreview = async () => {
    setIsPreviewing(true);
    setError(null);
    setPreviewItems(null);
    setSummaryReport(null);

    try {
      const parsed = JSON.parse(jsonText);
      const res = await apiFetch(`/api/restaurants/${currentRestaurantId}/import-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuJson: parsed }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');

      setPreviewItems(data.previewItems);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid JSON or server error');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleCommitImport = async () => {
    if (!previewItems) return;
    setIsCommitting(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/restaurants/${currentRestaurantId}/import-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewItems,
          userOverrides,
          actor: 'restaurant_owner',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Commit failed');

      setSummaryReport(data.summary);
      if (onImportComplete) onImportComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error committing menu import');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleApplyOverride = (assetId: string | null) => {
    if (!activeOverrideItem) return;
    setUserOverrides((prev) => ({
      ...prev,
      [activeOverrideItem.id]: assetId,
    }));

    // Update local preview state
    setPreviewItems((prev) =>
      prev
        ? prev.map((item) => {
            if (item.id === activeOverrideItem.id) {
              const matchedAsset = assetId ? approvedAssets.find((a) => a.id === assetId) : undefined;
              return {
                ...item,
                proposedAsset: matchedAsset,
                status: assetId ? 'manual_locked' : 'no_image_match',
                isLocked: Boolean(assetId),
              };
            }
            return item;
          })
        : null
    );

    setActiveOverrideItem(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 pb-24">
      {/* Page Header */}
      <div className="py-6 border-b border-slate-800 mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <FileCode className="w-6 h-6 text-amber-500" /> Menu JSON Import & Image Matcher
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Intelligently matches incoming dish titles against approved canonical food images, preserves previous assignments, and respects manual owner locks.
        </p>
      </div>

      {/* JSON Input Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-white">Menu JSON Payload</h2>
            <p className="text-xs text-slate-400">
              Paste the JSON for this restaurant menu, then preview it before committing changes:
            </p>
          </div>


        </div>

        <textarea
          rows={9}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          className="w-full p-3.5 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-200 focus:outline-none focus:border-amber-500 mb-4"
        />

        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-500/40 rounded-xl text-xs text-rose-300 font-medium mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Preserves existing assignments and locked owner choices
          </span>

          <button
            onClick={handleRunPreview}
            disabled={isPreviewing}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition flex items-center gap-2 shadow-lg shadow-amber-900/30"
          >
            {isPreviewing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Matching Catalog...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" /> Validate & Preview Matching
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preview Section */}
      {previewItems && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800 mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Import Preview ({previewItems.length} items)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Review proposed image assignments before committing to production.
              </p>
            </div>

            <button
              onClick={handleCommitImport}
              disabled={isCommitting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition flex items-center gap-2 shadow-lg shadow-emerald-900/30"
            >
              {isCommitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving Transaction...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" /> Commit Menu & Assignments
                </>
              )}
            </button>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3">Item Name</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Price</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Canonical Match</th>
                  <th className="py-3 px-3">Proposed 480x480 Image</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {previewItems.map((item) => {
                  const hasImage = Boolean(item.proposedAsset);

                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-3 font-semibold text-white">
                        <div className="flex items-center gap-2">
                          {item.name}
                          {item.isLocked && (
                            <span title="Locked manual assignment">
                              <Lock className="w-3 h-3 text-amber-400 inline" />
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <span className="text-[11px] text-slate-400 font-normal line-clamp-1">
                            {item.description}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3">{item.category}</td>
                      <td className="py-3 px-3 font-mono text-amber-400">${item.price.toFixed(2)}</td>

                      {/* Status Badges */}
                      <td className="py-3 px-3">
                        {item.status === 'preserved_existing' && (
                          <span className="px-2 py-0.5 bg-blue-950 border border-blue-500/40 text-blue-300 rounded text-[10px] font-semibold whitespace-nowrap">
                            Preserved
                          </span>
                        )}
                        {item.status === 'manual_locked' && (
                          <span className="px-2 py-0.5 bg-purple-950 border border-purple-500/40 text-purple-300 rounded text-[10px] font-semibold whitespace-nowrap flex items-center gap-1 w-max">
                            <Lock className="w-2.5 h-2.5" /> Owner Locked
                          </span>
                        )}
                        {item.status === 'new_assignment' && (
                          <span className="px-2 py-0.5 bg-emerald-950 border border-emerald-500/40 text-emerald-300 rounded text-[10px] font-semibold whitespace-nowrap">
                            Auto-Assigned
                          </span>
                        )}
                        {item.status === 'needs_review' && (
                          <span className="px-2 py-0.5 bg-amber-950 border border-amber-500/40 text-amber-300 rounded text-[10px] font-semibold whitespace-nowrap">
                            Needs Review
                          </span>
                        )}
                        {item.status === 'no_image_match' && (
                          <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-[10px] font-semibold whitespace-nowrap">
                            Placeholder
                          </span>
                        )}
                      </td>

                      {/* Canonical Match Info */}
                      <td className="py-3 px-3">
                        {item.canonicalMatch ? (
                          <div>
                            <span className="font-medium text-slate-200">
                              {item.canonicalMatch.dishName}
                            </span>
                            <span className="block text-[10px] text-slate-400">
                              Confidence: {(item.canonicalMatch.confidence * 100).toFixed(0)}% (
                              {item.canonicalMatch.matchType})
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">No canonical match</span>
                        )}
                      </td>

                      {/* Image Thumbnail */}
                      <td className="py-3 px-3">
                        {hasImage ? (
                          <div className="flex items-center gap-2">
                            <img
                              src={item.proposedAsset?.publicUrl}
                              alt="Thumbnail"
                              className="w-10 h-10 rounded-lg object-cover bg-black border border-slate-700"
                            />
                            <div className="text-[10px] text-slate-400">
                              <span className="font-semibold text-white block">
                                {item.proposedAsset?.dishName}
                              </span>
                              <span>{item.proposedAsset?.licenseType}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">
                            No image assigned
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => setActiveOverrideItem(item)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-medium transition"
                        >
                          Change / Override
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import Summary Modal */}
      {summaryReport && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/50 w-full max-w-lg rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 text-emerald-400 mb-4">
              <CheckCircle2 className="w-8 h-8 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-bold text-white">Menu Import Committed</h3>
                <p className="text-xs text-slate-400">
                  Transactions committed successfully to restaurant tenant store.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6 font-mono text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] uppercase block">Total Items</span>
                <span className="text-lg font-bold text-white">{summaryReport.totalProcessed}</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] uppercase block">Auto-Assigned</span>
                <span className="text-lg font-bold text-emerald-400">
                  {summaryReport.automaticallyAssigned}
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] uppercase block">Preserved Existing</span>
                <span className="text-lg font-bold text-blue-400">{summaryReport.preservedExisting}</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] uppercase block">Items without images</span>
                <span className="text-lg font-bold text-slate-400">
                  {summaryReport.noImageMatched + summaryReport.needsReview}
                </span>
              </div>
            </div>

            <button
              onClick={() => setSummaryReport(null)}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition"
            >
              Done & Return to Menu
            </button>
          </div>
        </div>
      )}

      {/* Manual Asset Selection Modal */}
      {activeOverrideItem && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">
                  Select Approved Asset for "{activeOverrideItem.name}"
                </h3>
                <p className="text-xs text-slate-400">
                  Manually selecting an image locks this assignment against automated re-import overwrites.
                </p>
              </div>
              <button
                onClick={() => setActiveOverrideItem(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="mb-4">
              <button
                onClick={() => handleApplyOverride(null)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Clear Image Assignment
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {approvedAssets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => handleApplyOverride(asset.id)}
                  className="cursor-pointer bg-slate-950 border border-slate-800 hover:border-amber-500 rounded-xl p-2 transition group"
                >
                  <img
                    src={asset.publicUrl}
                    alt={asset.dishName}
                    className="w-full aspect-square object-cover rounded-lg bg-black mb-1.5"
                  />
                  <h4 className="text-xs font-semibold text-white truncate">{asset.dishName}</h4>
                  <span className="text-[10px] text-slate-400 block truncate">
                    {asset.licenseType}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
