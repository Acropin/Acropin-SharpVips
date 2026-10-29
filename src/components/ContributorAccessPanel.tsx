import React, { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, ShieldOff, Users } from 'lucide-react';
import { apiFetch } from '../lib/client/api';

interface ContributorAccount {
  id: string;
  login: string;
  name?: string;
  avatarUrl: string;
  profileUrl: string;
  accessStatus: 'active' | 'blocked';
  contributionCount: number;
  createdAt: string;
  lastLoginAt: string;
}

const statusStyles: Record<ContributorAccount['accessStatus'], string> = {
  active: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  blocked: 'border-rose-800 bg-rose-950/50 text-rose-300',
};

export function ContributorAccessPanel() {
  const [accounts, setAccounts] = useState<ContributorAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/admin/contributors');
      const body = await response.json().catch(() => ({})) as { contributors?: ContributorAccount[]; error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not load contributor accounts.');
      setAccounts(body.contributors || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load contributor accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const changeAccess = async (account: ContributorAccount, status: 'active' | 'blocked') => {
    setUpdatingId(account.id);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/contributors/${encodeURIComponent(account.id)}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not update contributor access.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update contributor access.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-sky-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-100">GitHub contributors</h2>
            <p className="text-xs text-slate-400">GitHub sign-in enables contributor access automatically. Block accounts here only when access needs to be revoked.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => void refresh()} disabled={loading} className="flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-xs text-rose-300">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-slate-800 bg-slate-950/70 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Access</th>
              <th className="px-4 py-3 font-medium">Contributions</th>
              <th className="px-4 py-3 font-medium">Last sign-in</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && accounts.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading contributor accounts…</td></tr>
            ) : accounts.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No GitHub contributors have signed in yet.</td></tr>
            ) : accounts.map((account) => (
              <tr key={account.id}>
                <td className="px-4 py-3">
                  <a href={account.profileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 hover:text-sky-300">
                    <img src={account.avatarUrl} alt="" className="h-8 w-8 rounded-full bg-slate-800" />
                    <span><span className="block font-medium text-slate-100">@{account.login}</span><span className="block text-[11px] text-slate-500">{account.name || 'GitHub contributor'}</span></span>
                  </a>
                </td>
                <td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] capitalize ${statusStyles[account.accessStatus]}`}>{account.accessStatus}</span></td>
                <td className="px-4 py-3 text-slate-300">{account.contributionCount}</td>
                <td className="px-4 py-3 text-slate-400">{new Date(account.lastLoginAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {account.accessStatus === 'blocked' && (
                      <button onClick={() => void changeAccess(account, 'active')} disabled={updatingId === account.id} className="flex min-h-8 items-center gap-1 rounded-md bg-emerald-700 px-2.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                        {updatingId === account.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Reactivate
                      </button>
                    )}
                    {account.accessStatus !== 'blocked' && (
                      <button onClick={() => void changeAccess(account, 'blocked')} disabled={updatingId === account.id} className="flex min-h-8 items-center gap-1 rounded-md border border-slate-700 px-2.5 text-[11px] text-slate-300 hover:border-rose-800 hover:text-rose-300 disabled:opacity-50">
                        <ShieldOff className="h-3 w-3" /> Block
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
