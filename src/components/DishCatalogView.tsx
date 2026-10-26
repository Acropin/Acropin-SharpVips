/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  BookOpen, 
  Search, 
  ShieldCheck, 
  Leaf, 
  Flame, 
  Database, 
  HardDrive, 
  Cloud,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { CANONICAL_DISHES } from '../lib/catalog/canonical-dishes';
import type { CanonicalDish } from '../lib/images/types';

export const DishCatalogView: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selectedCuisine, setSelectedCuisine] = useState('all');

  const cuisines = ['all', ...Array.from(new Set(CANONICAL_DISHES.map((d) => d.cuisine)))];

  const filtered = CANONICAL_DISHES.filter((d) => {
    const matchCuisine = selectedCuisine === 'all' || d.cuisine === selectedCuisine;
    const q = search.toLowerCase().trim();
    const matchSearch =
      !q ||
      d.canonicalName.toLowerCase().includes(q) ||
      d.aliases.some((a) => a.toLowerCase().includes(q)) ||
      d.ingredients.some((i) => i.toLowerCase().includes(q));
    return matchCuisine && matchSearch;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
      {/* Header */}
      <div className="py-6 border-b border-slate-800 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-amber-500" /> Curated Canonical Dish Catalog
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Standardized culinary taxonomy, verified aliases, dietary flags, and approved asset associations.
          </p>
        </div>

        {/* Storage Architecture Badge */}
        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs flex items-center gap-2.5">
          <HardDrive className="w-4 h-4 text-emerald-400" />
          <div>
            <span className="font-semibold text-slate-200 block">Storage Provider: Local Disk + CDN Cache</span>
            <span className="text-[10px] text-slate-400">R2/S3 Interface Compatible • Immutable WebP</span>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search canonical name, alias, or ingredient..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {cuisines.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedCuisine(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition capitalize ${
                selectedCuisine === c
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Dishes Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((dish) => (
          <div
            key={dish.id}
            className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 hover:border-slate-700 transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <span className="text-[10px] font-mono text-amber-500/90 uppercase tracking-wider block">
                    {dish.id}
                  </span>
                  <h3 className="text-base font-bold text-white mt-0.5">{dish.canonicalName}</h3>
                </div>

                {dish.dietary === 'veg' ? (
                  <span className="px-2 py-0.5 bg-emerald-950 border border-emerald-500/40 text-emerald-400 rounded text-[10px] font-semibold flex items-center gap-1">
                    <Leaf className="w-3 h-3" /> Veg
                  </span>
                ) : dish.dietary === 'vegan' ? (
                  <span className="px-2 py-0.5 bg-emerald-900 border border-emerald-400/40 text-emerald-300 rounded text-[10px] font-semibold flex items-center gap-1">
                    <Leaf className="w-3 h-3" /> Vegan
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-rose-950 border border-rose-500/40 text-rose-400 rounded text-[10px] font-semibold flex items-center gap-1">
                    <Flame className="w-3 h-3" /> Non-Veg
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-300 mb-3 leading-relaxed">{dish.preparation}</p>

              {/* Aliases */}
              <div className="mb-3">
                <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                  Approved Aliases ({dish.aliases.length}):
                </span>
                <div className="flex flex-wrap gap-1">
                  {dish.aliases.map((alias) => (
                    <span
                      key={alias}
                      className="px-2 py-0.5 bg-slate-950 text-slate-300 rounded text-[11px] border border-slate-800"
                    >
                      {alias}
                    </span>
                  ))}
                </div>
              </div>

              {/* Ingredients */}
              <div className="mb-4">
                <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                  Key Ingredients:
                </span>
                <span className="text-[11px] text-slate-400">
                  {dish.ingredients.join(', ')}
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>{dish.cuisine} • {dish.category}</span>
              <span className="text-emerald-400 flex items-center gap-1 font-medium text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5" /> Curated
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
