import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyContributorLeaderboard } from './contributor-rewards.js';

const profiles = ['alice', 'bob', 'cara', 'blocked'].map((login) => ({
  id: `github_${login}`,
  login,
  name: login,
  avatarUrl: `https://avatars.example/${login}`,
  profileUrl: `https://github.com/${login}`,
  accessStatus: login === 'blocked' ? 'blocked' as const : 'active' as const,
}));

function image(login: string, approvalStatus: 'approved' | 'pending_review' = 'approved', updatedAt = '2026-10-12T12:00:00.000Z') {
  return {
    approvalStatus,
    contributorId: `github_${login}`,
    contributorGitHub: login,
    updatedAt,
  };
}

test('monthly leaderboard rewards only top three active contributors for approved images', () => {
  const result = buildMonthlyContributorLeaderboard(profiles, [
    image('alice'), image('alice'), image('alice'),
    image('bob'), image('bob'),
    image('cara'),
    image('blocked', 'approved'),
    image('cara', 'pending_review'),
    image('bob', 'approved', '2026-09-30T23:59:59.000Z'),
  ], new Date('2026-10-29T12:00:00.000Z'));

  assert.equal(result.period.key, '2026-10');
  assert.deepEqual(result.entries.map(({ login, rank, points, reward }) => ({ login, rank, points, reward })), [
    { login: 'alice', rank: 1, points: 3, reward: 'Gold Chef' },
    { login: 'bob', rank: 2, points: 2, reward: 'Silver Chef' },
    { login: 'cara', rank: 3, points: 1, reward: 'Bronze Chef' },
  ]);
});

test('monthly leaderboard resolves older assets by GitHub login and returns no fabricated ranks', () => {
  const result = buildMonthlyContributorLeaderboard(profiles, [{
    approvalStatus: 'approved',
    contributorId: undefined,
    contributorGitHub: '@Cara',
    updatedAt: '2026-10-29T12:00:00.000Z',
  }], new Date('2026-10-29T12:00:00.000Z'));

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.login, 'cara');
  assert.equal(result.entries[0]?.reward, 'Gold Chef');
});

test('equal scores are ordered by who reached the score first', () => {
  const result = buildMonthlyContributorLeaderboard(profiles, [
    image('alice', 'approved', '2026-10-10T12:00:00.000Z'),
    image('bob', 'approved', '2026-10-11T12:00:00.000Z'),
  ], new Date('2026-10-29T12:00:00.000Z'));

  assert.deepEqual(result.entries.map(({ login, rank }) => ({ login, rank })), [
    { login: 'alice', rank: 1 },
    { login: 'bob', rank: 2 },
  ]);
});

