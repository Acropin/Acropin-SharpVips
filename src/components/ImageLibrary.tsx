/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Search,
  Upload,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Shield,
  Layers,
  Hash,
  ExternalLink,
  Filter,
  RefreshCw,
  Plus,
  Sliders,
  Check,
  Ban
} from 'lucide-react';
import type { AssetApprovalStatus, ImageAsset, LicenseType, RestaurantMenu } from '../lib/images/types';

interface ImageLibraryProps {
  currentRestaurantId: string;
  onAssetAssignedToItem?: () => void;
}

export const ImageLibrary: React.FC<ImageLibraryProps> = ({
  currentRestaurantId,
  onAssetAssignedToItem,
}) => {
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedAsset, setSelectedAsset] = useState<ImageAsset | null>(null);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [focalX, setFocalX] = useState<number>(0.5);
  const [focalY, setFocalY] = useState<number>(0.5);
  const [dishNameInput, setDishNameInput] = useState('');
  const [licenseTypeInput, setLicenseTypeInput] = useState<LicenseType>('Studio-Acropin-Proprietary');
  const [licenseEvidenceInput, setLicenseEvidenceInput] = useState('');
  const [attributionInput, setAttributionInput] = useState('');
  const [autoApproveInput, setAutoApproveInput] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Assign to menu item modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [restaurantMenu, setRestaurantMenu] = useState<RestaurantMenu | null>(null);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);

  // Revocation impact report modal state
  const [revocationReport, setRevocationReport] = useState<{
    assetId: string;
    affectedItems: Array<{ restaurantId: string; restaurantName: string; itemId: string; itemName: string }>;
  } | null>(null);

  useEffect(() => {
    fetchAssets();
  }, [selectedStatus]);

  useEffect(() => {
    if (showAssignModal) {
      fetch(`/api/restaurants/${currentRestaurantId}/menu`)
        .then((r) => r.json())
        .then((d) => setRestaurantMenu(d.menu))
        .catch(console.error);
    }
  }, [showAssignModal, currentRestaurantId]);

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const url =
        selectedStatus === 'all'
          ? '/api/images/catalog'
          : `/api/images/catalog?status=${selectedStatus}`;
      const res = await fetch(url);
      const data = await res.json();
      setAssets(data.assets || []);
    } catch (err) {
      console.error('Error fetching assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (assetId: string, newStatus: AssetApprovalStatus) => {
    try {
      const res = await fetch(`/api/images/catalog/${assetId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          reason: newStatus === 'revoked' ? 'Revoked by governance review' : undefined,
        }),
      });
      const data = await res.json();

      if (newStatus === 'revoked' && data.revocationReport?.affectedItems?.length > 0) {
        setRevocationReport({
          assetId,
          affectedItems: data.revocationReport.affectedItems,
        });
      }

      fetchAssets();
      if (selectedAsset?.id === assetId) {
        setSelectedAsset(data.asset);
      }
    } catch (err) {
      alert('Failed to update asset status');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadFile(file);
      setUploadPreviewUrl(URL.createObjectURL(file));
      if (!dishNameInput) {
        // Default dish name from filename
        const name = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setDishNameInput(name.charAt(0).toUpperCase() + name.slice(1));
      }
    }
  };

  const handleFocalPointClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocalX(Number(x.toFixed(2)));
    setFocalY(Number(y.toFixed(2)));
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setIsUploading(true);
    setUploadFeedback(null);

    const formData = new FormData();
    formData.append('image', uploadFile);
    formData.append('dishName', dishNameInput);
    formData.append('focalPointX', focalX.toString());
    formData.append('focalPointY', focalY.toString());
    formData.append('licenseType', licenseTypeInput);
    formData.append('licenseEvidence', licenseEvidenceInput || 'Internal studio production');
    formData.append('requiredAttribution', attributionInput);
    formData.append('autoApprove', autoApproveInput ? 'true' : 'false');

    try {
      const res = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setUploadFeedback({
        type: 'success',
        message: `Successfully processed 480x480 WebP! Output size: ${(data.asset.byteSize / 1024).toFixed(1)} KB (Quality: ${data.asset.processingQuality}). ${data.isDeduplicated ? 'Identical content hash deduplicated.' : ''}`,
      });

      fetchAssets();
      setTimeout(() => {
        setShowUploadModal(false);
        setUploadFile(null);
        setUploadPreviewUrl(null);
        setUploadFeedback(null);
      }, 1800);
    } catch (err: unknown) {
      setUploadFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error uploading and processing image.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAssignSubmit = async () => {
    if (!selectedAsset || !selectedMenuItemId) return;

    setIsAssigning(true);
    try {
      const res = await fetch(`/api/restaurants/${currentRestaurantId}/assignments/${selectedMenuItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: selectedAsset.id,
          actor: 'restaurant_owner',
        }),
      });

      if (!res.ok) throw new Error('Assignment failed');

      alert(`Asset "${selectedAsset.dishName}" successfully assigned and locked to menu item!`);
      setShowAssignModal(false);
      if (onAssetAssignedToItem) onAssetAssignedToItem();
    } catch (err) {
      alert('Failed to assign asset to menu item.');
    } finally {
      setIsAssigning(false);
    }
  };

  const filteredAssets = assets.filter((a) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      a.dishName.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q)) ||
      (a.requiredAttribution && a.requiredAttribution.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
      {/* Top Banner and Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-6 border-b border-slate-800 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-amber-500" /> Centralized Food Image Library
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Standardized 480 × 480 WebP assets with licensing provenance and cross-tenant deduplication.
          </p>
        </div>

        <button
          onClick={() => setShowUploadModal(true)}
          className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl text-sm transition flex items-center gap-2 shadow-lg shadow-amber-900/30"
        >
          <Upload className="w-4 h-4" /> Process & Add Image
        </button>
      </div>

      {/* Search and Status Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by dish name, tag, or attribution..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All Assets' },
            { id: 'approved', label: 'Approved' },
            { id: 'pending_review', label: 'Pending Review' },
            { id: 'rejected', label: 'Rejected' },
            { id: 'revoked', label: 'Revoked' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedStatus(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                selectedStatus === tab.id
                  ? 'bg-slate-800 text-amber-400 border border-amber-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-900/60 border border-slate-800/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Asset Grid */}
      {loading ? (
        <div className="text-center py-24 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-amber-500" />
          <p className="text-sm">Loading asset catalog...</p>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-slate-800 text-slate-400">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30 text-amber-500" />
          <p className="text-base font-medium text-slate-300">No image assets found</p>
          <p className="text-xs text-slate-500 mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredAssets.map((asset) => {
            const isApproved = asset.approvalStatus === 'approved';
            const isRevoked = asset.approvalStatus === 'revoked';
            const isPending = asset.approvalStatus === 'pending_review';

            return (
              <div
                key={asset.id}
                onClick={() => setSelectedAsset(asset)}
                className={`group cursor-pointer rounded-2xl bg-slate-900 border p-2 transition duration-200 flex flex-col justify-between ${
                  selectedAsset?.id === asset.id
                    ? 'border-amber-500 ring-2 ring-amber-500/30'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* 1:1 Aspect Ratio Container */}
                <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-slate-950 mb-2">
                  <img
                    src={asset.publicUrl}
                    alt={asset.dishName}
                    loading="lazy"
                    className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                  />

                  {/* Status Badge */}
                  <div className="absolute top-2 left-2">
                    {isApproved && (
                      <span className="px-2 py-0.5 bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 rounded text-[10px] font-semibold flex items-center gap-1 shadow-sm">
                        <CheckCircle className="w-2.5 h-2.5" /> Approved
                      </span>
                    )}
                    {isPending && (
                      <span className="px-2 py-0.5 bg-amber-950/90 border border-amber-500/50 text-amber-300 rounded text-[10px] font-semibold flex items-center gap-1 shadow-sm">
                        <AlertTriangle className="w-2.5 h-2.5" /> Review
                      </span>
                    )}
                    {isRevoked && (
                      <span className="px-2 py-0.5 bg-rose-950/90 border border-rose-500/50 text-rose-300 rounded text-[10px] font-semibold flex items-center gap-1 shadow-sm">
                        <Ban className="w-2.5 h-2.5" /> Revoked
                      </span>
                    )}
                  </div>

                  {/* Byte Size Tag */}
                  <div className="absolute bottom-2 right-2 bg-black/75 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-300">
                    {(asset.byteSize / 1024).toFixed(0)} KB
                  </div>
                </div>

                {/* Card Title & License */}
                <div className="px-1">
                  <h3 className="text-xs font-semibold text-white truncate mb-0.5">{asset.dishName}</h3>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="truncate">{asset.licenseType}</span>
                    <span className="font-mono text-slate-500">{asset.format.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Asset Detail Drawer / Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between pb-4 border-b border-slate-800 mb-4">
              <div>
                <span className="text-xs font-mono text-amber-400 uppercase tracking-wider">
                  Asset ID: {selectedAsset.id}
                </span>
                <h2 className="text-xl font-bold text-white mt-0.5">{selectedAsset.dishName}</h2>
              </div>
              <button
                onClick={() => setSelectedAsset(null)}
                className="text-slate-400 hover:text-white p-1 text-sm"
              >
                ✕ Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* 480x480 Preview */}
              <div>
                <div className="aspect-square w-full rounded-xl overflow-hidden bg-black border border-slate-800 relative">
                  <img
                    src={selectedAsset.publicUrl}
                    alt={selectedAsset.dishName}
                    className="w-full h-full object-cover"
                  />
                  {/* Focal point indicator */}
                  <div
                    className="absolute w-4 h-4 border-2 border-amber-400 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-md"
                    style={{
                      left: `${selectedAsset.focalPoint.x * 100}%`,
                      top: `${selectedAsset.focalPoint.y * 100}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1 text-center font-mono">
                  Exact Output: 480 × 480 px (WebP • sRGB)
                </p>
              </div>

              {/* Provenance & Metadata */}
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                  <h4 className="font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400" /> Licensing Provenance
                  </h4>
                  <div className="space-y-1.5 text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-500">License Type:</span>
                      <span className="font-medium text-amber-300">{selectedAsset.licenseType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Provider:</span>
                      <span>{selectedAsset.sourceProvider}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Evidence / Ref:</span>
                      <p className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                        {selectedAsset.licenseEvidence}
                      </p>
                    </div>
                    {selectedAsset.requiredAttribution && (
                      <div>
                        <span className="text-slate-500">Required Attribution:</span>
                        <p className="text-slate-300 italic mt-0.5">{selectedAsset.requiredAttribution}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-1.5 text-slate-300 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Output Size:</span>
                    <span>{(selectedAsset.byteSize / 1024).toFixed(1)} KB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Quality Used:</span>
                    <span>{selectedAsset.processingQuality} / 100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Focal Point:</span>
                    <span>
                      ({selectedAsset.focalPoint.x.toFixed(2)}, {selectedAsset.focalPoint.y.toFixed(2)})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">SHA-256 Hash:</span>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {selectedAsset.sha256Hash}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Storage Key:</span>
                    <p className="text-[10px] text-amber-400/90 truncate mt-0.5">
                      {selectedAsset.storageKey}
                    </p>
                  </div>
                </div>

                {/* Approval Status Toggle Buttons */}
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Catalog Governance:</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleStatusChange(selectedAsset.id, 'approved')}
                      disabled={selectedAsset.approvalStatus === 'approved'}
                      className={`py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 transition ${
                        selectedAsset.approvalStatus === 'approved'
                          ? 'bg-emerald-600 text-white cursor-default'
                          : 'bg-slate-800 hover:bg-emerald-700 text-slate-300'
                      }`}
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedAsset.id, 'pending_review')}
                      disabled={selectedAsset.approvalStatus === 'pending_review'}
                      className={`py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 transition ${
                        selectedAsset.approvalStatus === 'pending_review'
                          ? 'bg-amber-600 text-white cursor-default'
                          : 'bg-slate-800 hover:bg-amber-700 text-slate-300'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" /> Review
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Revoking this asset will remove it from all published menus and trigger safe fallbacks. Continue?')) {
                          handleStatusChange(selectedAsset.id, 'revoked');
                        }
                      }}
                      disabled={selectedAsset.approvalStatus === 'revoked'}
                      className={`py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 transition ${
                        selectedAsset.approvalStatus === 'revoked'
                          ? 'bg-rose-600 text-white cursor-default'
                          : 'bg-slate-800 hover:bg-rose-700 text-slate-300'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" /> Revoke
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <a
                href={selectedAsset.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open Direct CDN URL
              </a>

              <button
                onClick={() => setShowAssignModal(true)}
                disabled={selectedAsset.approvalStatus !== 'approved'}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Assign to Restaurant Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload and Process Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-amber-500" /> Sharp Food Image Ingestion
              </h2>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* File selector & Interactive Focal Point Picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  1. Select Source Image (JPG, PNG, WebP — Min 300px, Max 15MB)
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileSelect}
                  className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-amber-400 hover:file:bg-slate-700 cursor-pointer"
                />

                {uploadPreviewUrl && (
                  <div className="mt-3">
                    <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                      <span>Click image to position square focal crop:</span>
                      <span className="font-mono text-amber-400">
                        X: {focalX.toFixed(2)}, Y: {focalY.toFixed(2)}
                      </span>
                    </div>
                    <div
                      onClick={handleFocalPointClick}
                      className="relative w-full max-h-56 bg-black rounded-xl overflow-hidden cursor-crosshair border border-slate-800 flex items-center justify-center"
                    >
                      <img
                        src={uploadPreviewUrl}
                        alt="Upload preview"
                        className="max-h-56 object-contain"
                      />
                      {/* Focal Indicator Crosshair */}
                      <div
                        className="absolute w-6 h-6 border-2 border-amber-400 bg-amber-400/20 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                          left: `${focalX * 100}%`,
                          top: `${focalY * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Dish Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  2. Dish Title / Tag
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Crispy Falafel Bowl"
                  value={dishNameInput}
                  onChange={(e) => setDishNameInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* License Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    3. License Model
                  </label>
                  <select
                    value={licenseTypeInput}
                    onChange={(e) => setLicenseTypeInput(e.target.value as LicenseType)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="Studio-Acropin-Proprietary">Studio Acropin Proprietary</option>
                    <option value="CC0">CC0 (Public Domain)</option>
                    <option value="CC-BY-4.0">CC-BY-4.0 (Attribution)</option>
                    <option value="Unsplash-Commercial">Unsplash Commercial Free</option>
                    <option value="Custom-Commercial">Custom Restaurant Commercial</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Attribution (if required)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Photo by Studio X"
                    value={attributionInput}
                    onChange={(e) => setAttributionInput(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  License Evidence / Reference Document
                </label>
                <input
                  type="text"
                  placeholder="URL or document reference verifying commercial redistribution rights"
                  value={licenseEvidenceInput}
                  onChange={(e) => setLicenseEvidenceInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="autoApproveCheck"
                  checked={autoApproveInput}
                  onChange={(e) => setAutoApproveInput(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-0 bg-slate-950 border-slate-800"
                />
                <label htmlFor="autoApproveCheck" className="text-xs text-slate-300">
                  Approve immediately for restaurant assignments (skip pending review)
                </label>
              </div>

              {uploadFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-medium ${
                    uploadFeedback.type === 'success'
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-500/40'
                  }`}
                >
                  {uploadFeedback.message}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || isUploading}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition flex items-center gap-2"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Processing with Sharp...
                    </>
                  ) : (
                    'Process 480x480 WebP & Save'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign to Menu Item Modal */}
      {showAssignModal && selectedAsset && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6">
            <h3 className="text-base font-bold text-white mb-2">
              Assign Image to Menu Item
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Select an item in <strong className="text-amber-400">{restaurantMenu?.restaurantName}</strong> to link with{' '}
              <strong className="text-white">"{selectedAsset.dishName}"</strong>. This will set a manual lock to prevent automated overwrites.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Target Menu Item:
              </label>
              <select
                value={selectedMenuItemId}
                onChange={(e) => setSelectedMenuItemId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              >
                <option value="">-- Select an item --</option>
                {restaurantMenu?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} (${item.price.toFixed(2)}) — {item.category}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowAssignModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignSubmit}
                disabled={!selectedMenuItemId || isAssigning}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition"
              >
                {isAssigning ? 'Saving Assignment...' : 'Confirm & Lock Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revocation Impact Report Modal */}
      {revocationReport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-800/60 w-full max-w-lg rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-base font-bold text-white">Asset Revocation Impact Alert</h3>
            </div>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Asset <code className="text-rose-400 font-mono">{revocationReport.assetId}</code> was revoked. The following restaurant menu items have been transitioned to safe category placeholders:
            </p>

            <div className="max-h-48 overflow-y-auto space-y-2 mb-6">
              {revocationReport.affectedItems.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-semibold text-white">{item.itemName}</span>
                    <span className="text-slate-500 block text-[11px]">{item.restaurantName}</span>
                  </div>
                  <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded text-[10px] font-medium">
                    Placeholder Activated
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setRevocationReport(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition"
            >
              Acknowledge & Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
