/** Public monthly recognition based only on approved catalog images. */

import type { ImageAsset } from '../images/types.js';
import type { ContributorProfile } from './contributor-store.js';

type LeaderboardContributor = Pick<
  ContributorProfile,
  'id' | 'login' | 'name' | 'avatarUrl' | 'profileUrl' | 'accessStatus'
>;

type LeaderboardAsset = Pick<
  ImageAsset,
  'approvalStatus' | 'contributorId' | 'contributorGitHub' | 'updatedAt'
>;

export interface ContributorRewardEntry {
  rank: 1 | 2 | 3;
  login: string;
  name?: string;
  avatarUrl: string;
  profileUrl: string;
  approvedImages: number;
  points: number;
  reward: 'Gold Chef' | 'Silver Chef' | 'Bronze Chef';
}

const rewards: ContributorRewardEntry['reward'][] = ['Gold Chef', 'Silver Chef', 'Bronze Chef'];

function normalizeLogin(login: string | undefined): string {
  return (login ?? '').trim().replace(/^@/u, '').toLowerCase();
}

export function buildMonthlyContributorLeaderboard(
  contributors: LeaderboardContributor[],
  assets: LeaderboardAsset[],
  now = new Date()
): {
  period: { key: string; label: string; startsAt: string; endsAt: string };
  pointsRule: string;
  entries: ContributorRewardEntry[];
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const startsAt = new Date(Date.UTC(year, month, 1));
  const endsAt = new Date(Date.UTC(year, month + 1, 1));
  const startTime = startsAt.getTime();
  const endTime = endsAt.getTime();
  const activeContributors = contributors.filter((profile) => profile.accessStatus === 'active');
  const profilesById = new Map(activeContributors.map((profile) => [profile.id, profile]));
  const profilesByLogin = new Map(activeContributors.map((profile) => [normalizeLogin(profile.login), profile]));
  const scores = new Map<string, { profile: LeaderboardContributor; count: number; firstAwardAt: number }>();

  for (const asset of assets) {
    if (asset.approvalStatus !== 'approved') continue;
    const approvedAt = Date.parse(asset.updatedAt);
    if (!Number.isFinite(approvedAt) || approvedAt < startTime || approvedAt >= endTime) continue;

    const profile = (asset.contributorId && profilesById.get(asset.contributorId)) ||
      profilesByLogin.get(normalizeLogin(asset.contributorGitHub));
    if (!profile) continue;

    const current = scores.get(profile.id);
    if (current) {
      current.count += 1;
      current.firstAwardAt = Math.min(current.firstAwardAt, approvedAt);
    } else {
      scores.set(profile.id, { profile, count: 1, firstAwardAt: approvedAt });
    }
  }

  const ranked = [...scores.values()].sort((left, right) =>
    right.count - left.count ||
    left.firstAwardAt - right.firstAwardAt ||
    left.profile.login.localeCompare(right.profile.login, 'en', { sensitivity: 'base' })
  );

  return {
    period: {
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(startsAt),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
  pointsRule: '1 point for each image approved this month. Pending, rejected, revoked, and duplicate images do not count. Ties go to the contributor who reached the score first.',
    entries: ranked.slice(0, 3).map((entry, index) => ({
      rank: (index + 1) as 1 | 2 | 3,
      login: entry.profile.login,
      name: entry.profile.name,
      avatarUrl: entry.profile.avatarUrl,
      profileUrl: entry.profile.profileUrl,
      approvedImages: entry.count,
      points: entry.count,
      reward: rewards[index],
    })),
  };
}
