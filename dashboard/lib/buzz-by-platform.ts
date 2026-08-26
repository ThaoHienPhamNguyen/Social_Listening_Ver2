import type { ThreadsEngagementDaily, FacebookEngagementDaily } from './types';

export interface PlatformBuzz {
  label: string;
  pct: number;
}

// Caller pre-scopes the input window (Overview: 1 day; sector page: 7-day
// window filtered to 1 category) — this function is agnostic to that,
// mirroring computeOverviewMetrics/computeSectorMetrics's own convention.
export function computeBuzzByPlatform(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): PlatformBuzz[] {
  const counts = [
    { label: 'Báo điện tử', count: articles.length },
    { label: 'Threads', count: threadsRows.reduce((sum, r) => sum + r.post_count, 0) },
    { label: 'Facebook', count: facebookRows.reduce((sum, r) => sum + r.post_count, 0) },
  ];
  const total = counts.reduce((sum, p) => sum + p.count, 0);

  if (total === 0) {
    return counts.map((p) => ({ label: p.label, pct: 0 }));
  }

  // Largest-remainder rounding — same technique as computeDonutSegments
  // (lib/overview-metrics.ts) — so the 3 percentages always sum to 100.
  const raw = counts.map((p) => {
    const exact = (p.count / total) * 100;
    const floor = Math.floor(exact);
    return { label: p.label, floor, remainder: exact - floor };
  });
  const flooredSum = raw.reduce((sum, r) => sum + r.floor, 0);
  const remaining = 100 - flooredSum;
  const bonusLabels = new Set([...raw].sort((a, b) => b.remainder - a.remainder).slice(0, remaining).map((r) => r.label));

  return raw.map((r) => ({ label: r.label, pct: r.floor + (bonusLabels.has(r.label) ? 1 : 0) }));
}
