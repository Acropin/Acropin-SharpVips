import React, { useCallback, useEffect, useState } from 'react';
import { Award, ChefHat, RefreshCw, Trophy } from 'lucide-react';
import { apiFetch } from '../lib/client/api';

interface LeaderboardEntry {
  rank: 1 | 2 | 3;
  login: string;
  name?: string;
  avatarUrl: string;
  profileUrl: string;
  approvedImages: number;
  points: number;
  reward: 'Gold Chef' | 'Silver Chef' | 'Bronze Chef';
}

interface LeaderboardResponse {
  period: { key: string; label: string; startsAt: string; endsAt: string };
  pointsRule: string;
  entries: LeaderboardEntry[];
}

const rewardStyles: Record<LeaderboardEntry['rank'], { card: string; badge: string; medal: string }> = {
  1: {
    card: 'border-amber-500/40 bg-amber-500/10',
    badge: 'border-amber-400/40 bg-amber-400/15 text-amber-200',
    medal: 'text-amber-300',
  },
  2: {
    card: 'border-slate-400/40 bg-slate-400/10',
    badge: 'border-slate-300/40 bg-slate-300/15 text-slate-100',
    medal: 'text-slate-200',
  },
  3: {
    card: 'border-orange-700/50 bg-orange-800/10',
    badge: 'border-orange-500/40 bg-orange-500/15 text-orange-200',
    medal: 'text-orange-300',
  },
};

export function ContributorLeaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/contributors/leaderboard');
      const body = await response.json().catch(() => ({})) as LeaderboardResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not load contributor rewards.');
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load contributor rewards.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
            <Trophy className="h-4 w-4" /> Contributor rewards
          </p>
          <h2 className="text-2xl font-bold text-slate-100">Top 3 food-library contributors</h2>
          <p className="mt-1 text-sm text-slate-400">
            {data ? `${data.period.label} · standings reset monthly (UTC)` : 'Monthly recognition for approved images'}
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Award className="h-4 w-4 text-emerald-300" /> Monthly podium
        </div>
        {error ? (
          <p role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>
        ) : loading && !data ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading this month’s standings…</p>
        ) : data?.entries.length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((rank) => {
              const entry = data.entries.find((candidate) => candidate.rank === rank);
              const style = rewardStyles[rank as LeaderboardEntry['rank']];
              return (
                <article key={rank} className={`min-h-44 rounded-xl border p-4 ${style.card}`}>
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <span className={`text-2xl font-black ${style.medal}`}>{rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>{entry?.reward || ['Gold Chef', 'Silver Chef', 'Bronze Chef'][rank - 1]}</span>
                  </div>
                  {entry ? (
                    <>
                      <a href={entry.profileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-sky-200">
                        <img src={entry.avatarUrl} alt="" className="h-10 w-10 rounded-full bg-slate-800 object-cover" />
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-100">@{entry.login}</span><span className="block truncate text-xs text-slate-400">{entry.name || 'Food image contributor'}</span></span>
                      </a>
                      <p className="mt-4 text-sm font-semibold text-slate-200">{entry.points} {entry.points === 1 ? 'point' : 'points'}</p>
                      <p className="text-xs text-slate-400">{entry.approvedImages} approved {entry.approvedImages === 1 ? 'image' : 'images'}</p>
                    </>
                  ) : (
                    <div className="flex min-h-20 items-center gap-2 text-sm text-slate-500"><ChefHat className="h-5 w-5" /> Open spot</div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center">
            <ChefHat className="mx-auto mb-2 h-7 w-7 text-slate-500" />
            <p className="text-sm font-medium text-slate-200">The monthly podium is open</p>
            <p className="mt-1 text-xs text-slate-400">Approved contributions will appear here. Pending images do not earn points yet.</p>
          </div>
        )}
      </div>

      {data && <p className="text-xs leading-relaxed text-slate-500">{data.pointsRule} Only the top three active contributors are shown. Rewards are recognition badges; points are not cash or a promise of payment.</p>}
    </section>
  );
}
