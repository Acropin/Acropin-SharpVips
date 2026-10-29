/// <reference types="vite/client" />

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import chefHatLogo from './assets/chef-hat-logo.png';
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
  Sliders,
  Check,
  Trash2,
  Search,
  Layers,
  FileImage,
  FolderHeart,
  Info,
  ArrowRight,
  Database,
  ShieldCheck,
  ShieldAlert,
  Github,
  User,
  Table as TableIcon,
  Clock,
  Eye,
  FileSpreadsheet,
  X,
  Trophy,
} from 'lucide-react';
import type { ImageAsset, MlInspectionResult } from './lib/images/types';
import type { InventoryTableRow } from './lib/server/dataset-target-store';
import { apiFetch, setAdminToken } from './lib/client/api';
import { InventoryExcelTable } from './components/InventoryExcelTable';
import { ReviewQueueView } from './components/ReviewQueueView';
import { MetadataInspectorModal } from './components/MetadataInspectorModal';
import { VariantPreviewModal } from './components/VariantPreviewModal';
import { ContributorAccessPanel } from './components/ContributorAccessPanel';
import { ContributorLeaderboard } from './components/ContributorLeaderboard';

interface ProcessResponse {
  asset: ImageAsset;
  warning?: string;
  sourceDimensions?: { width: number; height: number };
  compressionRatio?: string;
  mlInspection?: MlInspectionResult;
}

interface DatasetResponse {
  totalTargetDishes: number;
  completedCount: number;
  missingCount: number;
  pendingCount: number;
  coveragePercent: number;
  rows: InventoryTableRow[];
}

type ContributionLicense = '' | 'CC0' | 'CC-BY-4.0';
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
type AccessState = 'checking' | 'required' | 'unconfigured' | 'authenticated' | 'blocked' | 'unavailable';

function readContributorGitHub(): string {
  try {
    const saved = window.localStorage.getItem('acropin_contributor_github') || '';
    return saved === 'acropin-contributor' ? '' : saved;
  } catch {
    return '';
  }
}

function saveContributorGitHub(value: string): void {
  try {
    if (value) window.localStorage.setItem('acropin_contributor_github', value);
    else window.localStorage.removeItem('acropin_contributor_github');
    window.localStorage.removeItem('acropin_contributor_email');
  } catch {
    // Browser storage can be unavailable in private or embedded browsing contexts.
  }
}

interface GitHubContributor {
  id: string;
  login: string;
  name?: string;
  avatarUrl: string;
  profileUrl: string;
  accessStatus: 'active' | 'blocked';
  contributionCount: number;
}

interface AuthStatusResponse {
  required: boolean;
  configured: boolean;
  authenticated: boolean;
  administrator?: boolean;
  githubConfigured?: boolean;
  dailyContributionLimit?: number;
  contributor?: GitHubContributor | null;
}

export default function App() {
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [adminAccessCode, setAdminAccessCode] = useState('');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [adminAccessRequired, setAdminAccessRequired] = useState(false);
  const [adminAccessConfigured, setAdminAccessConfigured] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [contributorDailyLimit, setContributorDailyLimit] = useState(3);
  const [currentContributor, setCurrentContributor] = useState<GitHubContributor | null>(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [signInModalMessage, setSignInModalMessage] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'inventory' | 'processor' | 'queue' | 'assets' | 'contributors' | 'leaderboard'>('inventory');
  const [inputMode, setInputMode] = useState<'upload' | 'url'>('upload');

  // File & URL state
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');

  // Dish identity always comes from the imported menu inventory.
  const [selectedTargetId, setSelectedTargetId] = useState('');

  // Contributor and rights metadata
  const [contributorGitHub, setContributorGitHub] = useState<string>(readContributorGitHub);
  const [licenseType, setLicenseType] = useState<ContributionLicense>('');
  const [requiredAttribution, setRequiredAttribution] = useState('');
  const [rightsAttested, setRightsAttested] = useState(false);
  const [submitDirect, setSubmitDirect] = useState<boolean>(false);

  // Focal point
  const [focalX, setFocalX] = useState<number>(0.5);
  const [focalY, setFocalY] = useState<number>(0.5);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<ProcessResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inventory Table state
  const [datasetData, setDatasetData] = useState<DatasetResponse | null>(null);
  const [isLoadingDataset, setIsLoadingDataset] = useState<boolean>(false);
  const selectedTarget = datasetData?.rows.find((row) => row.id === selectedTargetId);
  const dishTitle = selectedTarget?.name ?? '';
  const universalSlug = selectedTarget?.universalSlug ?? '';

  // Review Queue state
  const [pendingAssets, setPendingAssets] = useState<ImageAsset[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState<boolean>(false);

  // Catalog Assets
  const [catalog, setCatalog] = useState<ImageAsset[]>([]);
  const [assetSearch, setAssetSearch] = useState<string>('');

  // Modals state
  const [inspectingAsset, setInspectingAsset] = useState<ImageAsset | null>(null);
  const [viewingVariantsAsset, setViewingVariantsAsset] = useState<ImageAsset | null>(null);

  // Drag and drop
  const [isDragOver, setIsDragOver] = useState(false);

  const refreshAuthStatus = useCallback(async (): Promise<AuthStatusResponse> => {
    const response = await apiFetch('/api/auth/status');
    if (!response.ok) throw new Error('Could not check dashboard access.');
    const status = await response.json() as AuthStatusResponse;
    setAdminAccessRequired(status.required);
    setAdminAccessConfigured(status.configured);
    setGithubConfigured(Boolean(status.githubConfigured));
    setContributorDailyLimit(status.dailyContributionLimit || 3);
    setCurrentContributor(status.contributor || null);
    if (status.administrator) {
      setIsAdmin(true);
      setAccessState('authenticated');
    } else if (status.contributor?.accessStatus === 'active') {
      setIsAdmin(false);
      setAccessState('authenticated');
    } else if (status.contributor?.accessStatus === 'blocked') {
      setIsAdmin(false);
      setAccessState('blocked');
    } else if (status.required && !status.configured && !status.githubConfigured) {
      setIsAdmin(false);
      setAccessState('unconfigured');
      setActiveTab((tab) => tab === 'inventory' ? 'assets' : tab);
    } else {
      setIsAdmin(false);
      setAdminToken(null);
      setAccessState('required');
      setActiveTab((tab) => tab === 'inventory' ? 'assets' : tab);
    }
    return status;
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshAuthStatus().catch(() => {
        if (!cancelled) setAccessState('unavailable');
      });
    return () => { cancelled = true; };
  }, [refreshAuthStatus]);

  useEffect(() => {
    const handleOAuthMessage = (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      const message = data as { type?: unknown; result?: unknown; message?: unknown };
      if (message.type !== 'acropin-github-oauth') return;
      if (message.result === 'sign-in-failed') {
        setSignInModalMessage(typeof message.message === 'string'
          ? message.message
          : 'GitHub could not complete sign-in. Close this dialog and try again.');
        return;
      }

      void refreshAuthStatus().then((status) => {
        setShowSignInModal(false);
        setSignInModalMessage(null);
        if (status.contributor?.accessStatus === 'active' || status.administrator) {
          setAuthNotice(`Signed in${status.contributor ? ` as @${status.contributor.login}` : ''}. Your selected image and form are still here; continue when ready.`);
        } else if (status.contributor?.accessStatus === 'blocked') {
          setAuthNotice('This GitHub account is blocked from submitting images. Contact the library owner for help.');
        }
      }).catch(() => setSignInModalMessage('Sign-in finished, but access could not be refreshed. Reload this page and try again.'));
    };
    const handleWindowMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      handleOAuthMessage(event.data);
    };
    window.addEventListener('message', handleWindowMessage);
    const authChannel = 'BroadcastChannel' in window ? new BroadcastChannel('acropin-auth') : null;
    authChannel?.addEventListener('message', (event: MessageEvent<unknown>) => handleOAuthMessage(event.data));
    return () => {
      window.removeEventListener('message', handleWindowMessage);
      authChannel?.close();
    };
  }, [refreshAuthStatus]);

  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  // Save contributor settings to localStorage
  useEffect(() => {
    saveContributorGitHub(contributorGitHub);
  }, [contributorGitHub]);

  // Load Inventory Dataset
  const fetchDataset = useCallback(async () => {
    setIsLoadingDataset(true);
    try {
      const res = await apiFetch('/api/dataset/targets', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setDatasetData(data);
      } else {
        console.error('Failed to load dataset targets:', await res.text());
      }
    } catch (err) {
      console.error('Failed to load dataset targets:', err);
    } finally {
      setIsLoadingDataset(false);
    }
  }, []);

  // Keep already-open contributor inventories in sync with owner imports.
  useEffect(() => {
    if (accessState !== 'authenticated' || activeTab !== 'inventory') return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void fetchDataset();
    };
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [accessState, activeTab, fetchDataset]);

  // Load Review Queue
  const fetchReviewQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    try {
      const res = await apiFetch('/api/images/review-queue');
      if (res.ok) {
        const data = await res.json();
        setPendingAssets(data.pending || []);
      }
    } catch (err) {
      console.error('Failed to load review queue:', err);
    } finally {
      setIsLoadingQueue(false);
    }
  }, []);

  // Load Approved Catalog
  const fetchCatalog = useCallback(async () => {
    try {
      const res = await apiFetch('/api/images/catalog?status=approved');
      if (res.ok) {
        const data = await res.json();
        setCatalog(data.assets || []);
      }
    } catch (err) {
      console.error('Failed to load catalog:', err);
    }
  }, []);

  useEffect(() => {
    if (accessState === 'checking' || accessState === 'unavailable') return;
    fetchCatalog();
    if (accessState === 'authenticated') {
      fetchDataset();
      if (isAdmin) fetchReviewQueue();
      else setPendingAssets([]);
    } else {
      setDatasetData(null);
      setPendingAssets([]);
    }
  }, [accessState, isAdmin, fetchDataset, fetchReviewQueue, fetchCatalog]);

  // A CSV/menu row is the single source of dish name and slug.
  const handleSelectForContribution = (row: InventoryTableRow) => {
    setSelectedTargetId(row.id);
    setLastResult(null);
    setErrorMessage(null);
    setActiveTab('processor');
  };

  const selectImageFile = (selected: File) => {
    if (selected.size > MAX_UPLOAD_BYTES) {
      setErrorMessage('Choose an image smaller than 3.5 MB. The hosted Vercel upload endpoint has a 4.5 MB request limit.');
      return;
    }
    if (!selected.type.startsWith('image/')) {
      setErrorMessage('Choose a supported image file.');
      return;
    }
    setErrorMessage(null);
    setFile(selected);
    setFilePreview(URL.createObjectURL(selected));
    setInputMode('upload');
    if (accessState === 'required' || accessState === 'unconfigured') {
      setSignInModalMessage('Sign in before submitting. Your selected image will stay on this page.');
      setShowSignInModal(true);
    }
  };

  // Drag and drop handling
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      selectImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      selectImageFile(e.target.files[0]);
    }
  };

  // Process & Submit Image
  const handleProcessAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (accessState !== 'authenticated') {
      if (accessState === 'required' || accessState === 'unconfigured') {
        setSignInModalMessage('Sign in before submitting. Your selected image and form details will stay on this page.');
        setShowSignInModal(true);
      } else if (accessState === 'blocked') {
        setErrorMessage('This GitHub account cannot submit images. Contact the library owner for help.');
      } else {
        setErrorMessage('The sign-in service is unavailable. Try again in a moment.');
      }
      return;
    }
    if (inputMode === 'upload' && !file) {
      setErrorMessage('Please drop or select an image file.');
      return;
    }
    if (inputMode === 'url' && !imageUrl.trim()) {
      setErrorMessage('Please enter an image URL.');
      return;
    }
    if (!selectedTarget || selectedTarget.status !== 'missing') {
      setErrorMessage('Choose a missing dish from the imported menu inventory first.');
      return;
    }
    if (!licenseType || !rightsAttested) {
      setErrorMessage('Select a license and confirm you have the right to share this image.');
      return;
    }
    if (licenseType === 'CC-BY-4.0' && !requiredAttribution.trim()) {
      setErrorMessage('Attribution text is required for CC-BY-4.0 images.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setLastResult(null);

    try {
      let res: Response;
      if (inputMode === 'upload' && file) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('dishName', dishTitle);
        formData.append('universalName', universalSlug);
        formData.append('focalPointX', String(focalX));
        formData.append('focalPointY', String(focalY));
        formData.append('contributorGitHub', contributorGitHub);
        formData.append('submitDirect', String(submitDirect));
        formData.append('licenseType', licenseType);
        formData.append('requiredAttribution', requiredAttribution);
        formData.append('rightsAttested', String(rightsAttested));

        res = await apiFetch('/api/images/upload', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await apiFetch('/api/images/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl,
            dishName: dishTitle,
            universalName: universalSlug,
            focalPointX: focalX,
            focalPointY: focalY,
            contributorGitHub,
            submitDirect,
            licenseType,
            requiredAttribution,
            rightsAttested,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process image');
      }

      setLastResult(data);
      // Refresh inventory and queue
      fetchDataset();
      if (isAdmin) fetchReviewQueue();
      fetchCatalog();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Review Decision
  const handleReviewDecision = async (id: string, decision: 'approve' | 'reject', reason?: string) => {
    try {
      const res = await apiFetch(`/api/images/review-queue/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, rejectionReason: reason }),
      });
      if (res.ok) {
        fetchDataset();
        fetchReviewQueue();
        fetchCatalog();
      }
    } catch (err) {
      console.error('Failed to record review decision:', err);
    }
  };

  // Delete Target Dish
  const handleDeleteTarget = async (id: string) => {
    if (!confirm('Are you sure you want to remove this dish target from the inventory?')) return;
    try {
      const res = await apiFetch(`/api/dataset/targets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchDataset();
      }
    } catch (err) {
      console.error('Failed to delete target:', err);
    }
  };

  // Import CSV or Excel Data
  const handleImportCsvOrExcel = async (rawText: string) => {
    const res = await apiFetch('/api/dataset/targets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Import failed with status ${res.status}.`);
    }
    const body = await res.json() as { datasetStatus?: DatasetResponse };
    if (body.datasetStatus) setDatasetData(body.datasetStatus);
    else await fetchDataset();
  };

  // Add Target Dish
  const handleAddTargetDish = async (name: string, category: string, dietary: string) => {
    const res = await apiFetch('/api/dataset/targets/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, dietary }),
    });
    if (res.ok) {
      fetchDataset();
    }
  };

  const handleAdminLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccessError(null);
    setAdminToken(adminAccessCode);
    try {
      const response = await apiFetch('/api/auth/status');
      const status = await response.json() as AuthStatusResponse;
      setAdminAccessRequired(status.required);
      setAdminAccessConfigured(status.configured);
      if (!status.configured) {
        setAdminToken(null);
        setAccessState('unconfigured');
      } else if (!status.administrator) {
        setAdminToken(null);
        setAccessError('That access code was not accepted. Check it and try again.');
        setAccessState('required');
      } else {
        setIsAdmin(true);
        setCurrentContributor(null);
        setAdminAccessCode('');
        setAccessState('authenticated');
        setShowSignInModal(false);
        setSignInModalMessage(null);
      }
    } catch {
      setAdminToken(null);
      setAccessError('Could not reach the dashboard API. Check the deployment and try again.');
    }
  };

  const handleAdminLogout = () => {
    setAdminToken(null);
    setIsAdmin(false);
    setCurrentContributor(null);
    setAccessState('required');
    setDatasetData(null);
    setPendingAssets([]);
    setCatalog([]);
  };

  const handleContributorLogout = async () => {
    await apiFetch('/api/auth/github/logout', { method: 'POST' }).catch(() => undefined);
    setAdminToken(null);
    setCurrentContributor(null);
    setIsAdmin(false);
    setDatasetData(null);
    setCatalog([]);
    setAccessState('required');
  };

  const beginGitHubSignIn = () => {
    setSignInModalMessage(null);
    const popup = window.open(
      '/api/auth/github',
      'acropin-github-sign-in',
      'popup,width=520,height=720,resizable,scrollbars'
    );
    if (!popup) {
      setSignInModalMessage('Your browser blocked the sign-in popup. Allow popups for this site, then try again. Your image and form are still here.');
      return;
    }
    popup.focus();
  };

  if (accessState === 'checking' || accessState === 'unavailable') {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
          <div className="mb-5 flex items-center gap-3">
            <img src={chefHatLogo} alt="Acropin" className="h-11 w-11 object-contain" />
            <div>
              <h1 className="font-bold text-lg">Acropin Food Library</h1>
              <p className="text-xs text-slate-400">Contributor and owner sign-in</p>
            </div>
          </div>
          {accessState === 'checking' ? (
            <p className="text-sm text-slate-300">Checking dashboard access…</p>
          ) : (
            <div className="space-y-3 text-sm text-rose-200">
              <p>{accessError || 'The dashboard API is unavailable.'}</p>
              <button onClick={() => window.location.reload()} className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-100">Try again</button>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 min-h-16 py-2 sm:py-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <img src={chefHatLogo} alt="Acropin" className="h-10 w-10 shrink-0 object-contain" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base text-slate-100 tracking-tight">Acropin</h1>
                <span className="hidden sm:inline px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-semibold">
                  Universal Food Library
                </span>
              </div>
              <p className="hidden md:block truncate text-xs text-slate-400">Food image library and contributor tools</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav aria-label="Main navigation" className="flex max-w-full sm:w-auto overflow-x-auto items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
            <button
              type="button"
              aria-label="Inventory"
              title="Inventory"
              onClick={() => {
                if (accessState === 'authenticated') setActiveTab('inventory');
                else {
                  setSignInModalMessage('Sign in to open contributor inventory and editing tools.');
                  setShowSignInModal(true);
                }
              }}
              className={`min-h-10 shrink-0 px-3 sm:px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'inventory'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Inventory</span>
            </button>

            <button
              type="button"
              aria-label="Process and contribute"
              title="Process and contribute"
              onClick={() => setActiveTab('processor')}
              className={`min-h-10 shrink-0 px-3 sm:px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'processor'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Contribute</span>
            </button>

            {isAdmin && <button
              type="button"
              aria-label="Review queue"
              title="Review queue"
              onClick={() => setActiveTab('queue')}
              className={`min-h-10 shrink-0 px-3 sm:px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'queue'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Review Queue</span>
              {pendingAssets.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">
                  {pendingAssets.length}
                </span>
              )}
            </button>}

            <button
              type="button"
              aria-label="Catalog assets"
              title="Catalog assets"
              onClick={() => setActiveTab('assets')}
              className={`min-h-10 shrink-0 px-3 sm:px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'assets'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Assets ({catalog.length})</span>
            </button>
            <button
              type="button"
              aria-label="Contributor rewards"
              title="Contributor rewards"
              onClick={() => setActiveTab('leaderboard')}
              className={`min-h-10 shrink-0 px-3 sm:px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'leaderboard'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Rewards</span>
            </button>
            {isAdmin && <button
              type="button"
              aria-label="Contributor access"
              title="Contributor access"
              onClick={() => setActiveTab('contributors')}
              className={`min-h-10 shrink-0 px-3 sm:px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'contributors' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Contributors</span>
            </button>}
          </nav>
          {isAdmin && adminAccessRequired && (
            <button
              onClick={handleAdminLogout}
              className="self-end sm:self-auto sm:ml-2 min-h-10 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Lock dashboard
            </button>
          )}
          {!isAdmin && currentContributor && (
            <button onClick={() => void handleContributorLogout()} className="self-end sm:self-auto sm:ml-2 min-h-10 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
              Sign out @{currentContributor.login}
            </button>
          )}
          {(accessState === 'required' || accessState === 'unconfigured') && (
            <button
              onClick={() => { setSignInModalMessage(null); setShowSignInModal(true); }}
              className="self-end sm:self-auto sm:ml-2 min-h-10 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
            >
              Sign in to contribute
            </button>
          )}
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {authNotice && (
          <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            <span>{authNotice}</span>
            <button aria-label="Dismiss message" onClick={() => setAuthNotice(null)} className="shrink-0 text-emerald-200/80 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        )}
        {accessState === 'blocked' && (
          <div role="status" className="mb-4 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            This GitHub account cannot submit images. Contact the library owner if you think this is an error.
          </div>
        )}
        {/* TAB 1: EXCEL-LIKE SPREADSHEET INVENTORY */}
        {activeTab === 'inventory' && (
          <InventoryExcelTable
            rows={datasetData?.rows || []}
            totalCount={datasetData?.totalTargetDishes || 0}
            completedCount={datasetData?.completedCount || 0}
            missingCount={datasetData?.missingCount || 0}
            pendingCount={datasetData?.pendingCount || 0}
            coveragePercent={datasetData?.coveragePercent || 0}
            isLoading={isLoadingDataset}
            onRefresh={fetchDataset}
            onSelectForContribution={handleSelectForContribution}
            onInspectMetadata={(asset) => setInspectingAsset(asset)}
            onViewVariants={(asset) => setViewingVariantsAsset(asset)}
            onDeleteTarget={handleDeleteTarget}
            onImportCsvOrExcel={handleImportCsvOrExcel}
            onAddTargetDish={handleAddTargetDish}
            readOnly={!isAdmin}
          />
        )}

        {activeTab === 'contributors' && isAdmin && <ContributorAccessPanel />}

        {activeTab === 'leaderboard' && <ContributorLeaderboard />}

        {/* TAB 2: IMAGE PROCESSOR & CONTRIBUTOR DROP ZONE */}
        {activeTab === 'processor' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-sky-400" />
                    Food Image Processing & Clean Metadata Stamper
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Creates a 128px thumbnail and 480px menu image. Larger 960px and 1600px versions are included when the source resolution supports them. Image content and redistribution rights require human review.
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                  <button
                    onClick={() => setInputMode('upload')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      inputMode === 'upload' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                    }`}
                  >
                    Upload / Drop
                  </button>
                  <button
                    onClick={() => setInputMode('url')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      inputMode === 'url' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                    }`}
                  >
                    Image URL
                  </button>
                </div>
              </div>

              <form onSubmit={handleProcessAndSubmit} className="space-y-5">
                {/* File Drop Zone or URL Input */}
                {inputMode === 'upload' ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                      isDragOver
                        ? 'border-sky-400 bg-sky-950/20'
                        : file
                        ? 'border-emerald-500/50 bg-emerald-950/10'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                    }`}
                  >
                    {filePreview ? (
                      <div className="flex flex-col items-center gap-3">
                        <img
                          src={filePreview}
                          alt="Preview"
                          className="w-32 h-32 object-cover rounded-xl shadow-lg border border-slate-700"
                        />
                        <div className="text-xs text-slate-300">
                          <span className="font-semibold text-emerald-400">{file?.name}</span> (
                          {file ? (file.size / 1024).toFixed(1) : 0} KB)
                        </div>
                        <label className="cursor-pointer text-xs text-sky-400 hover:text-sky-300 underline font-medium">
                          Choose different file
                          <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                        </label>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                          <Upload className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-200">
                            Drag and drop food image here, or{' '}
                            <label className="text-sky-400 hover:text-sky-300 underline cursor-pointer">
                              browse files
                              <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                            </label>
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Supports browser image formats up to 3.5 MB per file. Choose a license and confirm redistribution rights below.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Image URL *</label>
                    <div className="relative">
                      <LinkIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        placeholder="HTTPS URL to the image"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500"
                      />
                    </div>
                  </div>
                )}

                {selectedTarget && (
                  <div className="rounded-xl border border-sky-900/70 bg-sky-950/30 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">Suggested image-generation prompt</p>
                    <p className="mt-1 break-words text-xs leading-relaxed text-slate-200">
                      {`Award-winning commercial cuisine and product photograph of ${selectedTarget.name}${selectedTarget.dietary !== 'unknown' ? ` (${selectedTarget.dietary})` : ''}, professional studio lighting, shallow depth of field, 8k resolution, crisp detail, gourmet restaurant menu presentation, clean minimalist background, photorealistic style, no text, no watermark.`}
                    </p>
                  </div>
                )}

                {/* Dish identity comes from a selected imported menu row. */}
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Selected menu item</p>
                      {selectedTarget ? (
                        <>
                          <p className="mt-1 truncate text-sm font-semibold text-slate-100">{selectedTarget.name}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-emerald-400">{selectedTarget.universalSlug}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{selectedTarget.category}{selectedTarget.region ? ` · ${selectedTarget.region}` : ''}</p>
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400">Import your menu CSV, then choose a missing dish from Menu Inventory.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('inventory')}
                      className="min-h-9 shrink-0 rounded-lg border border-slate-700 px-3 text-xs font-medium text-sky-300 hover:bg-slate-800"
                    >
                      {selectedTarget ? 'Change dish' : 'Open Menu Inventory'}
                    </button>
                  </div>
                </div>

                {/* Contributor and rights metadata */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                    <span className="flex items-center gap-1.5 text-slate-200">
                      <User className="w-4 h-4 text-sky-400" />
                      Contributor and redistribution rights
                    </span>
                    <span className="text-[11px] text-slate-400">Reviewed before public release</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">GitHub contributor</label>
                      {currentContributor ? (
                        <div className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 text-xs text-slate-200">
                          <img src={currentContributor.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
                          <a href={currentContributor.profileUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">@{currentContributor.login}</a>
                          <span className="ml-auto text-[10px] text-emerald-300">Verified</span>
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={contributorGitHub}
                          onChange={(e) => setContributorGitHub(e.target.value)}
                          placeholder="GitHub username"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                        />
                      )}
                    </div>
                    <div>
                      <label htmlFor="contribution-license" className="block text-[11px] text-slate-400 mb-1">License *</label>
                      <select
                        id="contribution-license"
                        value={licenseType}
                        onChange={(e) => setLicenseType(e.target.value as ContributionLicense)}
                        required
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                      >
                        <option value="">Select a license</option>
                        <option value="CC0">CC0-1.0</option>
                        <option value="CC-BY-4.0">CC-BY-4.0</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-[11px] leading-relaxed text-slate-500">No source or proof links are needed here. Choose the license you can grant and confirm the rights checkbox; reviewers can still reject submissions that do not meet the library license rules.</p>

                  {licenseType === 'CC-BY-4.0' && (
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Required attribution *</label>
                      <input
                        type="text"
                        value={requiredAttribution}
                        onChange={(e) => setRequiredAttribution(e.target.value)}
                        placeholder="Creator, title, source, and license"
                        required
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                      />
                    </div>
                  )}

                  <label className="flex items-start gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={rightsAttested}
                      onChange={(e) => setRightsAttested(e.target.checked)}
                      required
                      className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                    />
                    <span>I created this image or have permission to redistribute it under the selected license.</span>
                  </label>

                  {!isAdmin && <p className="border-t border-slate-800/80 pt-3 text-[11px] leading-relaxed text-amber-200/80">
                    Each dish name can have one active submission. A pending or published dish is locked against repeat uploads; an administrator can reopen it if a submission is rejected. Limit: {contributorDailyLimit} unique dishes per UTC day.
                  </p>}

                  {/* Submission target choice */}
                  {isAdmin && <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={submitDirect}
                        onChange={(e) => setSubmitDirect(e.target.checked)}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                      />
                      <span>Approve immediately (admin only)</span>
                    </label>
                    <span className="text-[11px] text-slate-500">
                      {submitDirect ? 'Immediate live status' : 'Enters Review Queue'}
                    </span>
                  </div>}
                </div>

                {errorMessage && (
                  <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-xs text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Submit Button */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    onClick={(event) => {
                      if (accessState === 'required' || accessState === 'unconfigured') {
                        event.preventDefault();
                        setSignInModalMessage('Sign in to submit this contribution. Your image and form details are saved in this page.');
                        setShowSignInModal(true);
                      }
                    }}
                    disabled={isProcessing}
                    className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-sky-950/50 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Processing image and sanitizing metadata…</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>{submitDirect ? 'Process & Direct Commit' : 'Process & Submit to Review Queue'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Last Processing Result Card */}
            {lastResult && (
              <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-6 shadow-xl animate-in fade-in duration-200 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Image processed into {lastResult.asset.acropinMetadata?.variantsAvailable.length ?? 2} WebP sizes.</span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    Status:{' '}
                    <span className={lastResult.asset.approvalStatus === 'approved' ? 'text-emerald-400 font-bold' : 'text-sky-400 font-bold'}>
                      {lastResult.asset.approvalStatus.toUpperCase()}
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col items-center justify-center bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <img
                      src={lastResult.asset.thumbnailUrl || lastResult.asset.publicUrl}
                      alt={lastResult.asset.dishName}
                      className="w-32 h-32 object-contain rounded-lg shadow"
                    />
                    <div className="mt-2 text-xs font-mono text-slate-400 text-center">
                      Primary 480×480 WebP • {(lastResult.asset.byteSize / 1024).toFixed(1)} KB
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-2 text-xs">
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                      <div className="font-semibold text-slate-200">Generated Hierarchy Variants:</div>
                      <div className="text-slate-400 text-[11px] grid grid-cols-2 gap-2 pt-1 font-mono">
                        <div>• 128×128 (Thumbnail): {lastResult.asset.thumbnailByteSize ? (lastResult.asset.thumbnailByteSize / 1024).toFixed(1) : '—'} KB</div>
                        <div>• 480×480 (Card): {(lastResult.asset.byteSize / 1024).toFixed(1)} KB</div>
                        <div>• 960×960 (Retina 2x): {lastResult.asset.retinaByteSize ? (lastResult.asset.retinaByteSize / 1024).toFixed(1) : '—'} KB</div>
                        <div>• 1600×1600 (Hi-Res): {lastResult.asset.hiResByteSize ? (lastResult.asset.hiResByteSize / 1024).toFixed(1) : '—'} KB</div>
                      </div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between">
                      <span className="text-slate-300">Clean EXIF & Acropin Metadata Tags:</span>
                      <button
                        onClick={() => setInspectingAsset(lastResult.asset)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sky-400 text-[11px] font-medium"
                      >
                        Inspect Tags
                      </button>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setViewingVariantsAsset(lastResult.asset)}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium"
                      >
                        Inspect & Download {lastResult.asset.acropinMetadata?.variantsAvailable.length ?? 2} Sizes
                      </button>
                      <button
                        onClick={() => setActiveTab('inventory')}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs"
                      >
                        Return to Excel Table
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ORGANIZER REVIEW QUEUE */}
        {activeTab === 'queue' && (
          <ReviewQueueView
            pendingAssets={pendingAssets}
            isLoading={isLoadingQueue}
            onRefresh={fetchReviewQueue}
            onDecision={handleReviewDecision}
            onViewVariants={(asset) => setViewingVariantsAsset(asset)}
          />
        )}

        {/* TAB 4: CATALOG ASSETS GALLERY */}
        {activeTab === 'assets' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-100">Live Food Image Asset Library</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Approved WebP assets with short cache lifetimes so license revocations can take effect.
                </p>
              </div>
              <div className="relative w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter library..."
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {catalog
                .filter((a) => !assetSearch || a.dishName.toLowerCase().includes(assetSearch.toLowerCase()))
                .map((asset) => (
                  <div
                    key={asset.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all group"
                  >
                    <div className="relative aspect-square bg-slate-950 overflow-hidden">
                      <img
                        src={asset.thumbnailUrl || asset.publicUrl}
                        alt={asset.dishName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <button
                        onClick={() => setViewingVariantsAsset(asset)}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-medium transition-opacity gap-1"
                      >
                        <Eye className="w-4 h-4" />
                        {asset.acropinMetadata?.variantsAvailable.length ?? 2} Sizes
                      </button>
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="font-semibold text-slate-100 text-xs truncate" title={asset.dishName}>
                        {asset.dishName}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{asset.universalName}</div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                        <span>{(asset.byteSize / 1024).toFixed(1)} KB</span>
                        <button
                          onClick={() => setInspectingAsset(asset)}
                          className="text-sky-400 hover:text-sky-300"
                          title="Inspect metadata tags"
                        >
                          Tags
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </main>

      {/* MODALS */}
      {inspectingAsset && (
        <MetadataInspectorModal asset={inspectingAsset} onClose={() => setInspectingAsset(null)} />
      )}

      {viewingVariantsAsset && (
        <VariantPreviewModal asset={viewingVariantsAsset} onClose={() => setViewingVariantsAsset(null)} />
      )}

      {showSignInModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
          <button aria-label="Close sign-in dialog" className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setShowSignInModal(false)} />
          <section role="dialog" aria-modal="true" aria-labelledby="contributor-sign-in-title" className="relative z-10 w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
            <button aria-label="Close" onClick={() => setShowSignInModal(false)} className="absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
            <div className="mb-4 flex items-center gap-3 pr-8">
              <img src={chefHatLogo} alt="Acropin" className="h-10 w-10 object-contain" />
              <div>
                <h2 id="contributor-sign-in-title" className="text-base font-semibold text-white">Sign in to contribute</h2>
                <p className="text-xs text-slate-400">Your selected image stays on this page.</p>
              </div>
            </div>
            {signInModalMessage && <p role="alert" className="mb-3 rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-xs leading-relaxed text-amber-200">{signInModalMessage}</p>}
            {accessState === 'blocked' ? (
              <p className="text-sm text-rose-200">This GitHub account cannot submit images. Contact the library owner if you think this is an error.</p>
            ) : (
              <div className="space-y-4">
                {githubConfigured ? (
                  <button onClick={beginGitHubSignIn} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-100">
                    <Github className="h-4 w-4" /> Continue with GitHub
                  </button>
                ) : (
                  <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-xs leading-relaxed text-amber-200">
                    GitHub sign-in is not configured yet. The owner needs to create a GitHub OAuth App and add its client ID, client secret, callback URL, and session secret to this environment.
                  </div>
                )}
                {githubConfigured && <p className="text-center text-xs text-slate-400">GitHub sign-in creates your profile and enables contributor tools immediately. Submitted images still need rights and content review before they are published.</p>}
                {adminAccessRequired && !adminAccessConfigured && <p className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-200">Owner controls are unavailable until <code>ADMIN_API_TOKEN</code> is configured.</p>}
                {adminAccessConfigured && <>
                  <div className="border-t border-slate-800 pt-3 text-center text-[11px] uppercase tracking-wide text-slate-500">Owner sign-in</div>
                  <form onSubmit={handleAdminLogin} className="space-y-3">
                    <label htmlFor="modal-admin-access-code" className="block text-sm text-slate-300">Dashboard access code</label>
                    <input
                      id="modal-admin-access-code"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={adminAccessCode}
                      onChange={(event) => setAdminAccessCode(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                    />
                    {accessError && <p role="alert" className="text-xs text-rose-300">{accessError}</p>}
                    <button type="submit" className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Unlock owner dashboard</button>
                  </form>
                </>}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
