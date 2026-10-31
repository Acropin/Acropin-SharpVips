/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Download,
  Upload,
  Plus,
  Check,
  ShieldCheck,
  Trash2,
  Table as TableIcon,
  RefreshCw,
  Eye,
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
  readOnly?: boolean;
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
  readOnly = false,
}: InventoryExcelTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'missing' | 'in_review'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dietaryFilter, setDietaryFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Modals for Excel/CSV Import and Add Item
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newDishName, setNewDishName] = useState('');
  const [newDishCategory, setNewDishCategory] = useState('');
  const [newDishDietary, setNewDishDietary] = useState('');
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
      if (dietaryFilter !== 'all' && row.dietary !== dietaryFilter) return false;
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        return (
          row.name.toLowerCase().includes(query) ||
          row.universalSlug.toLowerCase().includes(query) ||
          row.category.toLowerCase().includes(query) ||
          (row.region || '').toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [rows, statusFilter, categoryFilter, dietaryFilter, searchTerm]);

  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const pageRows = filteredRows.slice((activePage - 1) * pageSize, activePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows, statusFilter, categoryFilter, dietaryFilter, searchTerm]);

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;
    setImportError(null);
    setIsSubmittingImport(true);
    try {
      await onImportCsvOrExcel(importText);
      setImportText('');
      setImportFileName('');
      setShowImportModal(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed. Check the file and try again.');
    } finally {
      setIsSubmittingImport(false);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setImportText('');
    setImportFileName('');
    setImportError(null);
    if (!/\.(csv|tsv|txt|xlsx|xls)$/iu.test(file.name)) {
      setImportError('Choose a .csv, .tsv, .xlsx, or .xls file.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setImportError('This file is larger than 3 MB. Split it into smaller CSV/TSV files and import again.');
      return;
    }
    try {
      let text: string;
      if (/\.xlsx?$/iu.test(file.name)) {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
          cellDates: false,
          cellFormula: false,
          WTF: true,
        });
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
        if (!firstSheet) throw new Error('This workbook has no readable worksheet.');
        text = XLSX.utils.sheet_to_csv(firstSheet, { blankrows: false });
        if (!text.trim()) throw new Error('The first worksheet is empty.');
      } else {
        text = await file.text();
      }
      setImportText(text);
      setImportFileName(file.name);
    } catch (error) {
      setImportError(error instanceof Error
        ? `Could not read this spreadsheet: ${error.message}`
        : 'Could not read this spreadsheet. Save it as UTF-8 CSV or XLSX and try again.');
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDishName.trim() || !newDishCategory || !newDishDietary) return;
    setIsSubmittingAdd(true);
    try {
      await onAddTargetDish(newDishName, newDishCategory, newDishDietary);
      setNewDishName('');
      setNewDishCategory('');
      setNewDishDietary('');
      setShowAddModal(false);
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-3 sm:px-5 sm:py-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-800">
          <div className="px-2 py-2 sm:py-0">
            <div className="text-[10px] sm:text-xs text-slate-400">TARGET DISHES</div>
            <div className="mt-1 text-lg sm:text-xl font-semibold text-slate-100 font-mono">{totalCount}</div>
          </div>
          <div className="px-2 py-2 sm:py-0 sm:pl-4">
            <div className="text-[10px] sm:text-xs text-emerald-400">AVAILABLE</div>
            <div className="mt-1 text-lg sm:text-xl font-semibold text-emerald-400 font-mono">{completedCount}</div>
          </div>
          <div className="px-2 py-2 sm:py-0 sm:pl-4">
            <div className="text-[10px] sm:text-xs text-amber-400">NEEDS IMAGE</div>
            <div className="mt-1 text-lg sm:text-xl font-semibold text-amber-400 font-mono">{missingCount}</div>
          </div>
          <div className="px-2 py-2 sm:py-0 sm:pl-4">
            <div className="text-[10px] sm:text-xs text-sky-400">IN REVIEW</div>
            <div className="mt-1 text-lg sm:text-xl font-semibold text-sky-400 font-mono">{pendingCount}</div>
          </div>
        </div>
        <div className="mt-3 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between gap-3 text-[11px] sm:text-xs text-slate-300 mb-2">
            <span>Library coverage</span>
            <span className="shrink-0 font-mono text-emerald-400 font-semibold">{coveragePercent}%</span>
          </div>
          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800 flex">
            <div className="h-full bg-emerald-500 transition-all duration-500 rounded-full" style={{ width: `${coveragePercent}%` }} />
            {pendingCount > 0 && totalCount > 0 && (
              <div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${Math.round((pendingCount / totalCount) * 100)}%` }} />
            )}
          </div>
        </div>
      </section>

      {/* Spreadsheet Control Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col xl:flex-row gap-3 items-stretch xl:items-center justify-between">
        <div className="flex flex-col sm:flex-row flex-1 items-stretch gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-0 sm:max-w-sm">
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
            className="w-full sm:w-auto bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-hidden focus:border-emerald-500"
          >
            <option value="all">All Courses / Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by dietary type"
            value={dietaryFilter}
            onChange={(e) => setDietaryFilter(e.target.value)}
            className="w-full sm:w-auto bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-hidden focus:border-emerald-500"
          >
            <option value="all">All dietary types</option>
            <option value="veg">Veg</option>
            <option value="non-veg">Non-veg</option>
            <option value="vegan">Vegan</option>
            <option value="egg">Egg</option>
            <option value="mixed">Mixed / check</option>
            <option value="unknown">Unspecified</option>
          </select>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex max-w-full overflow-x-auto items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setStatusFilter('all')}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({rows.length})
          </button>
          <button
            onClick={() => setStatusFilter('missing')}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'missing'
                ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Missing ({missingCount})
          </button>
          <button
            onClick={() => setStatusFilter('available')}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
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
              className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === 'in_review'
                  ? 'bg-sky-950/60 text-sky-300 border border-sky-800/60 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              In Review ({pendingCount})
            </button>
          )}
        </div>

        {/* Owner-only dataset editing actions */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2">
          {!readOnly && <button
            onClick={() => setShowAddModal(true)}
            className="justify-center px-2 sm:px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Add a new target dish"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Dish
          </button>}

          {!readOnly && <button
            onClick={() => setShowImportModal(true)}
            className="justify-center px-2 sm:px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Import Excel or CSV dataset"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Excel/CSV
          </button>}

          {!readOnly && <a
            href="/api/dataset/export-csv"
            download="acropin-food-inventory.csv"
            className="justify-center px-2 sm:px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-xs"
            title="Download real-time inventory spreadsheet"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </a>}

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="justify-center p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-colors flex items-center"
            title="Refresh table"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Excel-like Spreadsheet Data Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <p className="sm:hidden px-3 py-2 text-[10px] text-slate-500 border-b border-slate-800">Swipe the table sideways to see all columns.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-left border-collapse text-xs">
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
                <th className="py-3 px-3.5 w-36 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    <TableIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No menu target items matched your current filter.
                  </td>
                </tr>
              ) : (
                pageRows.map((row, idx) => {
                  const isAvailable = row.status === 'available';
                  const isInReview = row.status === 'in_review';
                  const isMissing = row.status === 'missing';
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        idx % 2 === 0 ? 'bg-slate-900/30' : 'bg-slate-900/80'
                      }`}
                    >
                      {/* Row Index */}
                      <td className="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px] border-r border-slate-800/60">
                        {(activePage - 1) * pageSize + idx + 1}
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
                              className="w-9 h-9 rounded object-contain border border-slate-700 group-hover:border-sky-400 transition-colors shadow-xs"
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
                        {row.region && <div className="mt-0.5 text-[10px] text-slate-500">{row.region}</div>}
                        <span
                          className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-medium mt-0.5 ${
                            row.dietary === 'veg'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-900/50'
                              : row.dietary === 'vegan'
                              ? 'bg-teal-950 text-teal-300 border border-teal-900/50'
                              : row.dietary === 'non-veg'
                              ? 'bg-red-950 text-red-300 border border-red-900/50'
                              : row.dietary === 'egg'
                              ? 'bg-amber-950 text-amber-300 border border-amber-900/50'
                              : row.dietary === 'mixed'
                              ? 'bg-violet-950 text-violet-300 border border-violet-900/50'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {row.dietary === 'unknown' ? 'Unspecified' : row.dietary === 'non-veg' ? 'Non-veg' : row.dietary === 'mixed' ? 'Mixed / check' : row.dietary}
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
                              title="View available image sizes"
                            >
                              <Eye className="w-3 h-3" />
                              {row.asset?.acropinMetadata?.variantsAvailable.length ?? 2} Sizes
                            </button>
                          )}

                          {!readOnly && <button
                            onClick={() => onDeleteTarget(row.id)}
                            title="Delete this target dish"
                            className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>}
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-400">
        <span>
          {filteredRows.length === 0
            ? 'No rows to show'
            : `Showing ${(activePage - 1) * pageSize + 1}–${Math.min(activePage * pageSize, filteredRows.length)} of ${filteredRows.length}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={activePage <= 1}
            className="min-h-10 flex-1 sm:flex-none rounded-lg border border-slate-700 px-3 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="min-w-16 text-center font-mono">{activePage} / {pageCount}</span>
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
            disabled={activePage >= pageCount}
            className="min-h-10 flex-1 sm:flex-none rounded-lg border border-slate-700 px-3 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>

      {/* Modal: Import Excel / CSV */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-h-[92dvh] overflow-y-auto max-w-xl w-full p-4 sm:p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-400" />
              Import menu data
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Upload CSV, TSV, XLSX, or XLS. Excel files use the first worksheet; row 1 must contain the column headers.
            </p>

            <form onSubmit={handleImportSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="dataset-import-file" className="inline-flex min-h-10 w-full sm:w-auto cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700">
                  <Upload className="w-4 h-4" />
                  Choose menu file
                </label>
                <input
                  id="dataset-import-file"
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleImportFile}
                  className="sr-only"
                />
                {importFileName && <p className="mt-2 truncate text-xs text-emerald-300" title={importFileName}>Ready: {importFileName}</p>}
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Required headers: item_name, menu_category. Optional: item_id, region, diet_type, is_vegetarian, description. Use Veg or Non-veg in diet_type (or Yes/No in is_vegetarian). Price and availability columns are ignored.
                </p>
                <label htmlFor="dataset-import-text" className="mt-4 mb-1 block text-xs font-medium text-slate-300">
                  Or paste spreadsheet cells
                </label>
                <textarea
                  id="dataset-import-text"
                  rows={6}
                  placeholder={'item_id,item_name,region,menu_category,diet_type,is_vegetarian\nFD0001,Dal makhani,North,Main Course,Veg,Yes'}
                  value={importText}
                  onChange={(e) => { setImportText(e.target.value); setImportFileName(''); setImportError(null); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              {importError && <p role="alert" className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-xs text-red-300">{importError}</p>}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowImportModal(false); setImportError(null); }}
                  className="min-h-10 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingImport || !importText.trim()}
                  className="min-h-10 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  {isSubmittingImport ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {isSubmittingImport ? 'Importing…' : 'Import rows'}
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
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
                  >
                    <option value="">Select category</option>
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
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
                  >
                    <option value="">Select dietary value</option>
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
