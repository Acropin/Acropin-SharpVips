/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Download,
  Upload,
  Plus,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Trash2,
  Table as TableIcon,
  RefreshCw,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';
import type { ImageAsset } from '../lib/images/types';
import type { InventoryTableRow } from '../lib/server/dataset-target-store';

interface InventoryExcelTableProps {
  rows: InventoryTableRow[];
  totalCount: number;
  completedCount: number;
  missingCount: number;
  pendingCount: number;
  coveragePercent: number;
  isLoading: boolean;
  onRefresh: () => void;
  onSelectForContribution: (row: InventoryTableRow) => void;
  onInspectMetadata: (asset: ImageAsset) => void;
  onViewVariants: (asset: ImageAsset) => void;
  onDeleteTarget: (id: string) => Promise<void>;
  onImportCsvOrExcel: (rawText: string) => Promise<void>;
  onAddTargetDish: (name: string, category: string, dietary: string) => Promise<void>;
}

export function InventoryExcelTable({
  rows,
  totalCount,
  completedCount,
  missingCount,
  pendingCount,
  coveragePercent,
  isLoading,
  onRefresh,
  onSelectForContribution,
  onInspectMetadata,
  onViewVariants,
  onDeleteTarget,
  onImportCsvOrExcel,
  onAddTargetDish,
}: InventoryExcelTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'missing' | 'in_review'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  // Modals for Excel/CSV Import and Add Item
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newDishName, setNewDishName] = useState('');
  const [newDishCategory, setNewDishCategory] = useState('Mains');
  const [newDishDietary, setNewDishDietary] = useState('veg');
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);

  // Extract distinct categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.category));
    return Array.from(set).filter(Boolean).sort();
  }, [rows]);

  // Filter rows
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        return (
          row.name.toLowerCase().includes(query) ||
          row.universalSlug.toLowerCase().includes(query) ||
          row.category.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [rows, statusFilter, categoryFilter, searchTerm]);

  const handleCopyPrompt = (prompt: string, id: string) => {
    navigator.clipboard.writeText(prompt);
    setCopiedPromptId(id);
    setTimeout(() => setCopiedPromptId(null), 2500);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;
    setIsSubmittingImport(true);
    try {
      await onImportCsvOrExcel(importText);
      setImportText('');
      setShowImportModal(false);
    } finally {
      setIsSubmittingImport(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDishName.trim()) return;
    setIsSubmittingAdd(true);
    try {
      await onAddTargetDish(newDishName, newDishCategory, newDishDietary);
      setNewDishName('');
      setShowAddModal(false);
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Real-time KPI Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>TOTAL TARGET DISHES</span>
            <FileSpreadsheet className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold text-slate-100 mt-1.5 font-mono">{totalCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">Live Database Targets</div>
        </div>

        <div className="bg-slate-900 border border-emerald-900/40 rounded-xl p-4 shadow-xs bg-gradient-to-br from-emerald-950/20 to-transparent">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-medium">
            <span>AVAILABLE IN LIBRARY</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-1.5 font-mono">{completedCount}</div>
          <div className="text-[11px] text-emerald-500/80 mt-1 flex items-center gap-1">
            <span>{coveragePercent}% Covered</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
          </div>
        </div>

        <div className="bg-slate-900 border border-amber-900/40 rounded-xl p-4 shadow-xs bg-gradient-to-br from-amber-950/20 to-transparent">
          <div className="flex items-center justify-between text-amber-400 text-xs font-medium">
            <span>MISSING (NEEDS IMAGE)</span>
            <AlertCircle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-1.5 font-mono">{missingCount}</div>
          <div className="text-[11px] text-amber-500/80 mt-1">Active contributor bounties</div>
        </div>

        <div className="bg-slate-900 border border-sky-900/40 rounded-xl p-4 shadow-xs bg-gradient-to-br from-sky-950/20 to-transparent">
          <div className="flex items-center justify-between text-sky-400 text-xs font-medium">
            <span>IN REVIEW QUEUE</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-sky-400 mt-1.5 font-mono">{pendingCount}</div>
          <div className="text-[11px] text-sky-500/80 mt-1">Awaiting organizer sign-off</div>
        </div>
      </div>

      {/* Real-time Progress Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between text-xs font-medium text-slate-300 mb-2">
          <span>Overall Food Image Library Coverage</span>
          <span className="font-mono text-emerald-400 font-semibold">{coveragePercent}% ({completedCount}/{totalCount} Completed)</span>
        </div>
        <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 flex">
          <div
            className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
            style={{ width: `${coveragePercent}%` }}
          />
          {pendingCount > 0 && totalCount > 0 && (
            <div
              className="h-full bg-sky-500 transition-all duration-500"
              style={{ width: `${Math.round((pendingCount / totalCount) * 100)}%` }}
            />
          )}
        </div>
      </div>

      {/* Spreadsheet Control Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex flex-1 items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search food dish name, slug..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-hidden focus:border-emerald-500"
          >
            <option value="all">All Courses / Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({rows.length})
          </button>
          <button
            onClick={() => setStatusFilter('missing')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'missing'
                ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Missing ({missingCount})
          </button>
          <button
            onClick={() => setStatusFilter('available')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'available'
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Available ({completedCount})
          </button>
          {pendingCount > 0 && (
            <button
              onClick={() => setStatusFilter('in_review')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === 'in_review'
                  ? 'bg-sky-950/60 text-sky-300 border border-sky-800/60 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              In Review ({pendingCount})
            </button>
          )}
        </div>

        {/* Action Buttons: Import, Export, Add */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Add a new target dish"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Dish
          </button>

          <button
            onClick={() => setShowImportModal(true)}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Import Excel or CSV dataset"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Excel/CSV
          </button>

          <a
            href="/api/dataset/export-csv"
            download="acropin-food-inventory.csv"
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-xs"
            title="Download real-time inventory spreadsheet"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </a>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
            title="Refresh table"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Excel-like Spreadsheet Data Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3 w-12 text-center border-r border-slate-800/80">#</th>
                <th className="py-3 px-3.5 w-32 border-r border-slate-800/80">Status</th>
                <th className="py-3 px-3.5 w-16 text-center border-r border-slate-800/80">Preview</th>
                <th className="py-3 px-4 min-w-[200px] border-r border-slate-800/80">Dish Name & Universal Slug</th>
                <th className="py-3 px-3.5 w-28 border-r border-slate-800/80">Category</th>
                <th className="py-3 px-3.5 w-36 border-r border-slate-800/80">Variants (WebP)</th>
                <th className="py-3 px-3.5 w-24 border-r border-slate-800/80">Size (KB)</th>
                <th className="py-3 px-3.5 w-32 border-r border-slate-800/80">Acropin Metadata</th>
                <th className="py-3 px-4 min-w-[190px] border-r border-slate-800/80">AI Contributor Prompt</th>
                <th className="py-3 px-3.5 w-36 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">
                    <TableIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No menu target items matched your current filter.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const isAvailable = row.status === 'available';
                  const isInReview = row.status === 'in_review';
                  const isMissing = row.status === 'missing';
                  const isPromptCopied = copiedPromptId === row.id;

                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        idx % 2 === 0 ? 'bg-slate-900/30' : 'bg-slate-900/80'
                      }`}
                    >
                      {/* Row Index */}
                      <td className="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px] border-r border-slate-800/60">
                        {idx + 1}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3.5 border-r border-slate-800/60">
                        {isAvailable && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-800/60 text-emerald-300 text-[11px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            Available
                          </span>
                        )}
                        {isInReview && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-sky-950/70 border border-sky-800/60 text-sky-300 text-[11px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                            In Review
                          </span>
                        )}
                        {isMissing && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-800/60 text-amber-300 text-[11px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                            Needs Image
                          </span>
                        )}
                      </td>

                      {/* Image Thumbnail Preview */}
                      <td className="py-2.5 px-3 text-center border-r border-slate-800/60">
                        {row.asset?.thumbnailUrl || row.asset?.publicUrl ? (
                          <button
                            onClick={() => row.asset && onViewVariants(row.asset)}
                            title="Click to view all 4 resolution variants"
                            className="inline-block relative group"
                          >
                            <img
                              src={row.asset.thumbnailUrl || row.asset.publicUrl}
                              alt={row.name}
                              className="w-9 h-9 rounded object-cover border border-slate-700 group-hover:border-sky-400 transition-colors shadow-xs"
                            />
                            <div className="absolute inset-0 bg-black/30 rounded opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                              <Eye className="w-3.5 h-3.5" />
                            </div>
                          </button>
                        ) : (
                          <div
                            onClick={() => onSelectForContribution(row)}
                            title="Click to drop image for this dish"
                            className="w-9 h-9 rounded border border-dashed border-slate-700 flex items-center justify-center mx-auto text-slate-600 hover:border-amber-500 hover:text-amber-400 transition-colors cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </td>

                      {/* Dish Name & Universal Slug */}
                      <td className="py-2.5 px-4 border-r border-slate-800/60">
                        <div className="font-semibold text-slate-100 text-xs">{row.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{row.universalSlug}</div>
                      </td>

                      {/* Category & Dietary */}
                      <td className="py-2.5 px-3.5 border-r border-slate-800/60">
                        <div className="text-slate-300 font-medium">{row.category}</div>
                        <span
                          className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-medium mt-0.5 ${
                            row.dietary === 'veg'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-900/50'
                              : row.dietary === 'vegan'
                              ? 'bg-teal-950 text-teal-300 border border-teal-900/50'
                              : 'bg-red-950 text-red-300 border border-red-900/50'
                          }`}
                        >
                          {row.dietary}
                        </span>
                      </td>

                      {/* Resolution Variants */}
                      <td className="py-2.5 px-3.5 border-r border-slate-800/60 font-mono text-[11px]">
                        {row.variantsAvailable.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.variantsAvailable.map((v) => (
                              <span
                                key={v}
                                className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-sky-300 text-[10px]"
                              >
                                {v.split('x')[0]}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Size & Format */}
                      <td className="py-2.5 px-3.5 border-r border-slate-800/60 font-mono text-[11px] text-slate-300">
                        {row.fileSizeKb > 0 ? (
                          <div>
                            <span className="font-bold text-slate-200">{row.fileSizeKb} KB</span>
                            <span className="text-[10px] text-slate-500 block">WebP (sRGB)</span>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Acropin Metadata Tags */}
                      <td className="py-2.5 px-3.5 border-r border-slate-800/60">
                        {row.asset ? (
                          <button
                            onClick={() => onInspectMetadata(row.asset!)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] transition-colors"
                            title="Inspect clean EXIF and Acropin tags"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Acropin Clean</span>
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[11px]">Pending asset</span>
                        )}
                      </td>

                      {/* AI Contributor Prompt (1-click copy) */}
                      <td className="py-2.5 px-4 border-r border-slate-800/60">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleCopyPrompt(row.recommendedAiPrompt, row.id)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[11px] font-medium transition-colors flex items-center gap-1 shrink-0"
                            title="Copy prompt for ChatGPT / DALL-E / Midjourney"
                          >
                            {isPromptCopied ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 text-amber-400" />
                                <span>Copy AI Prompt</span>
                              </>
                            )}
                          </button>
                          <span className="text-[10px] text-slate-500 truncate max-w-[120px]" title={row.recommendedAiPrompt}>
                            {row.recommendedAiPrompt}
                          </span>
                        </div>
                      </td>

                      {/* Row Actions */}
                      <td className="py-2.5 px-3.5 text-right font-sans">
                        <div className="flex items-center justify-end gap-1.5">
                          {isMissing ? (
                            <button
                              onClick={() => onSelectForContribution(row)}
                              className="px-2.5 py-1 bg-amber-600/90 hover:bg-amber-500 text-white rounded text-[11px] font-medium transition-colors flex items-center gap-1 shadow-xs"
                              title="Drop or upload image for this dish"
                            >
                              <Upload className="w-3 h-3" />
                              Contribute
                            </button>
                          ) : (
                            <button
                              onClick={() => row.asset && onViewVariants(row.asset)}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[11px] transition-colors flex items-center gap-1"
                              title="View all 4 resolution variants"
                            >
                              <Eye className="w-3 h-3" />
                              4 Sizes
                            </button>
                          )}

                          <button
                            onClick={() => onDeleteTarget(row.id)}
                            title="Delete this target dish"
                            className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Import Excel / CSV */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-400" />
              Import Dishes from Excel or CSV
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Paste rows directly from Microsoft Excel, Google Sheets, or CSV file.
            </p>

            <form onSubmit={handleImportSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Format: Dish Name, Category, Dietary (or tab-separated)
                </label>
                <textarea
                  rows={6}
                  required
                  placeholder={`Margherita Pizza, Mains, veg\nClassic Cheeseburger, Mains, non-veg\nCaesar Salad, Appetizers, veg`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingImport}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  {isSubmittingImport ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Import Rows to Database
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Single Target Dish */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Add Target Dish to Inventory
            </h3>

            <form onSubmit={handleAddSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Dish Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Avocado Toast"
                  value={newDishName}
                  onChange={(e) => setNewDishName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Course / Category</label>
                  <select
                    value={newDishCategory}
                    onChange={(e) => setNewDishCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
                  >
                    <option value="Mains">Mains</option>
                    <option value="Appetizers">Appetizers</option>
                    <option value="Desserts">Desserts</option>
                    <option value="Beverages">Beverages</option>
                    <option value="Sides">Sides</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Dietary</label>
                  <select
                    value={newDishDietary}
                    onChange={(e) => setNewDishDietary(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
                  >
                    <option value="veg">Vegetarian</option>
                    <option value="non-veg">Non-Vegetarian</option>
                    <option value="vegan">Vegan</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  {isSubmittingAdd ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Save Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
