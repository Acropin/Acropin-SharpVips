/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  Sparkles, 
  Leaf, 
  Flame, 
  WifiOff, 
  Wifi, 
  AlertCircle, 
  Info,
  CheckCircle2,
  UtensilsCrossed,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import type { DishDietary, MenuItem, RestaurantMenu } from '../lib/images/types';
import { apiFetch } from '../lib/client/api';

interface CustomerMenuProps {
  restaurantId: string;
  isSimulatedOffline: boolean;
  onToggleOffline: () => void;
}

export const CustomerMenu: React.FC<CustomerMenuProps> = ({
  restaurantId,
  isSimulatedOffline,
  onToggleOffline,
}) => {
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedDietary, setSelectedDietary] = useState<string>('all');
  const [cart, setCart] = useState<{ [itemId: string]: number }>({});
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [imageErrors, setImageErrors] = useState<{ [itemId: string]: boolean }>({});

  useEffect(() => {
    fetchMenu();
  }, [restaurantId]);

  const fetchMenu = async () => {
    setLoading(true);
    setError(null);
    try {
      // If simulated offline, check if we have cached data in localStorage
      if (isSimulatedOffline) {
        const cached = localStorage.getItem(`acropin_menu_cache_${restaurantId}`);
        if (cached) {
          setMenu(JSON.parse(cached));
          setLoading(false);
          return;
        }
      }

      const res = await apiFetch(`/api/restaurants/${restaurantId}/menu`);
      if (!res.ok) throw new Error('Failed to load menu');
      const data = await res.json();
      setMenu(data.menu);
      // Cache in localStorage for offline PWA simulation
      localStorage.setItem(`acropin_menu_cache_${restaurantId}`, JSON.stringify(data.menu));
    } catch (err: unknown) {
      // Try offline fallback
      const cached = localStorage.getItem(`acropin_menu_cache_${restaurantId}`);
      if (cached) {
        setMenu(JSON.parse(cached));
      } else {
        setError(err instanceof Error ? err.message : 'Error fetching menu');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = (itemId: string) => {
    setCart((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || 0) + 1,
    }));
  };

  const handleRemoveFromCart = (itemId: string) => {
    setCart((prev) => {
      const updated = { ...prev };
      if (updated[itemId] > 1) {
        updated[itemId]--;
      } else {
        delete updated[itemId];
      }
      return updated;
    });
  };

  const totalCartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const totalCartPrice = menu?.items.reduce((sum, item) => {
    return sum + (cart[item.id] || 0) * item.price;
  }, 0) || 0;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium">Loading restaurant menu...</p>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-slate-900 border border-red-800/40 rounded-xl text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-white mb-2">Unable to Load Menu</h3>
        <p className="text-sm text-slate-300 mb-4">{error || 'Menu data unavailable'}</p>
        <button
          onClick={fetchMenu}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  const categories = ['All', ...(menu.categories || [])];

  const filteredItems = menu.items.filter((item) => {
    const matchCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchDietary =
      selectedDietary === 'all' ||
      (selectedDietary === 'veg' && (item.dietary === 'veg' || item.dietary === 'vegan')) ||
      (selectedDietary === 'vegan' && item.dietary === 'vegan') ||
      (selectedDietary === 'non-veg' && item.dietary === 'non-veg');
    return matchCategory && matchDietary;
  });

  return (
    <div className="max-w-5xl mx-auto px-4 pb-28">
      {/* PWA Offline Simulation Banner */}
      <div className="my-4 p-3 bg-slate-800/80 border border-slate-700 rounded-xl flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2">
          {isSimulatedOffline ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full font-semibold">
              <WifiOff className="w-3.5 h-3.5" /> Simulated Offline Mode
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-semibold">
              <Wifi className="w-3.5 h-3.5" /> Live Online (PWA Ready)
            </span>
          )}
          <span className="text-slate-400 hidden sm:inline">
            {isSimulatedOffline
              ? 'Serving locally cached menu data and cached images without network requests'
              : 'Images served from immutable versioned cache'}
          </span>
        </div>
        <button
          onClick={onToggleOffline}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition"
        >
          {isSimulatedOffline ? 'Switch to Online' : 'Simulate Offline Mode'}
        </button>
      </div>

      {/* Restaurant Header */}
      <div className="relative rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 p-6 sm:p-8 mb-6 overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <UtensilsCrossed className="w-48 h-48 text-amber-500" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="w-4 h-4" /> {menu.cuisine} Cuisine • QR Table 04
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">{menu.restaurantName}</h1>
          <p className="text-slate-300 text-sm mb-4 leading-relaxed">{menu.tagline}</p>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-4 h-4" /> Centralized Image Provenance
            </span>
            <span>•</span>
            <span>{menu.items.length} Menu Items</span>
          </div>
        </div>
      </div>

      {/* Filter Controls: Category & Dietary */}
      <div className="sticky top-16 z-20 bg-slate-950/95 backdrop-blur-md py-3 border-b border-slate-800/80 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-900/20'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Dietary Filters */}
        <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs self-stretch sm:self-auto">
          {[
            { id: 'all', label: 'All' },
            { id: 'veg', label: '🌱 Veg' },
            { id: 'vegan', label: '🍃 Vegan' },
            { id: 'non-veg', label: '🍗 Non-Veg' },
          ].map((diet) => (
            <button
              key={diet.id}
              onClick={() => setSelectedDietary(diet.id)}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                selectedDietary === diet.id
                  ? 'bg-slate-800 text-amber-300 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {diet.label}
            </button>
          ))}
        </div>
      </div>

      {/* Menu Item Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredItems.map((item) => {
          const isError = imageErrors[item.id];
          const hasImage = Boolean(item.resolvedImageUrl) && !isError;
          const isRevoked = item.imageAssignment?.isRevokedFallback;
          const cartQty = cart[item.id] || 0;

          return (
            <div
              key={item.id}
              className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 flex gap-4 hover:border-slate-700 transition duration-200"
            >
              {/* Image Container with strict 1:1 Aspect Ratio to prevent layout shifts (CLS) */}
              <div className="w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0 relative rounded-xl overflow-hidden bg-slate-800 border border-slate-800/80">
                {hasImage ? (
                  <>
                    <img
                      src={item.resolvedImageUrl}
                      alt={item.name}
                      loading="lazy"
                      width={480}
                      height={480}
                      className="w-full h-full object-cover transition-opacity duration-300"
                      onError={() => {
                        setImageErrors((prev) => ({ ...prev, [item.id]: true }));
                      }}
                    />
                    {item.attribution && (
                      <div
                        title={item.attribution}
                        className="absolute bottom-1 right-1 bg-black/70 backdrop-blur-xs text-[9px] text-slate-300 px-1 py-0.5 rounded flex items-center gap-0.5"
                      >
                        <Info className="w-2.5 h-2.5" /> License
                      </div>
                    )}
                  </>
                ) : (
                  /* Stylized Category Placeholder */
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 p-2 text-center">
                    <UtensilsCrossed className="w-8 h-8 text-amber-500/60 mb-1" />
                    <span className="text-[10px] text-slate-400 font-medium line-clamp-1">
                      {isRevoked ? 'Asset Revoked' : item.category}
                    </span>
                    {isRevoked && (
                      <span className="text-[9px] text-amber-400 font-medium">Safe Fallback</span>
                    )}
                  </div>
                )}

                {/* Dietary badge on top left of image */}
                {item.dietary && (
                  <div className="absolute top-1.5 left-1.5">
                    {item.dietary === 'veg' ? (
                      <span className="bg-emerald-950/90 border border-emerald-500/50 text-emerald-400 p-1 rounded-md flex items-center justify-center">
                        <Leaf className="w-3 h-3" />
                      </span>
                    ) : item.dietary === 'vegan' ? (
                      <span className="bg-emerald-900/90 border border-emerald-400/50 text-emerald-300 p-1 rounded-md flex items-center justify-center">
                        <Leaf className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="bg-rose-950/90 border border-rose-500/50 text-rose-400 p-1 rounded-md flex items-center justify-center">
                        <Flame className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Item Info */}
              <div className="flex-1 flex flex-col justify-between min-w-0">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-base font-semibold text-white truncate">{item.name}</h3>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 mb-2 leading-relaxed">
                    {item.description || 'Artisanal dish freshly prepared to order with authentic seasonal ingredients.'}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-base font-bold text-amber-400">
                    ${item.price.toFixed(2)}
                  </span>

                  {/* Add to Cart / Quantity Selector */}
                  {cartQty > 0 ? (
                    <div className="flex items-center gap-2 bg-amber-600/20 border border-amber-600/40 rounded-lg p-0.5">
                      <button
                        onClick={() => handleRemoveFromCart(item.id)}
                        className="w-7 h-7 flex items-center justify-center text-amber-300 font-bold hover:bg-amber-600/40 rounded transition"
                      >
                        -
                      </button>
                      <span className="text-xs font-bold text-white px-1">{cartQty}</span>
                      <button
                        onClick={() => handleAddToCart(item.id)}
                        className="w-7 h-7 flex items-center justify-center text-amber-300 font-bold hover:bg-amber-600/40 rounded transition"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleAddToCart(item.id)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-amber-600 text-slate-200 hover:text-white rounded-lg text-xs font-semibold transition border border-slate-700 hover:border-amber-500 flex items-center gap-1.5"
                    >
                      <span>Add</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredItems.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <UtensilsCrossed className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No items found matching the selected filters.</p>
        </div>
      )}

      {/* Floating Cart Button (PWA Bottom Bar) */}
      {totalCartCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-40">
          <button
            onClick={() => setShowCartDrawer(true)}
            className="w-full bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-bold py-3.5 px-6 rounded-2xl shadow-xl shadow-amber-900/40 flex items-center justify-between transition-all"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-xs">
                {totalCartCount}
              </div>
              <span className="text-sm">View Current Order</span>
            </div>
            <div className="flex items-center gap-1 text-sm">
              <span>${totalCartPrice.toFixed(2)}</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}

      {/* Simple Cart Summary Modal */}
      {showCartDrawer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-amber-500" /> Your Order ({totalCartCount} items)
              </h2>
              <button
                onClick={() => setShowCartDrawer(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-3 mb-6 pr-1">
              {menu.items
                .filter((item) => (cart[item.id] || 0) > 0)
                .map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400 font-semibold">{cart[item.id]}x</span>
                      <span className="text-slate-200">{item.name}</span>
                    </div>
                    <span className="text-slate-400 font-medium">
                      ${(item.price * cart[item.id]).toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between mb-6 text-base font-bold text-white">
              <span>Total Amount</span>
              <span className="text-amber-400">${totalCartPrice.toFixed(2)}</span>
            </div>

            <button
              onClick={() => {
                alert(`Order confirmed for Table 04! Total: $${totalCartPrice.toFixed(2)}`);
                setCart({});
                setShowCartDrawer(false);
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-center transition flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" /> Send Order to Kitchen
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
