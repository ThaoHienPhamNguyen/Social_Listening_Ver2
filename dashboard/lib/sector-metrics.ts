import type { CandidateTopic, ThreadsEngagementDaily, FacebookEngagementDaily } from './types';
import { threadsEngagementTotal } from './topic-engagement';
import { facebookEngagementTotal } from './facebook-summary';

export interface SectorMetrics {
  buzzVolume7d: number;
  activeTopics: number;
  audienceScale7d: number;
}

// Same formulas as computeOverviewMetrics (lib/overview-metrics.ts), scoped
// to a single category and a 7-day window instead of one day, all
// categories — caller is responsible for pre-filtering every input array to
// the category + date range (see get-sector-metrics.ts).
export function computeSectorMetrics(
  candidates: CandidateTopic[],
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): SectorMetrics {
  const buzzVolume7d =
    articles.length +
    threadsRows.reduce((sum, r) => sum + r.post_count, 0) +
    facebookRows.reduce((sum, r) => sum + r.post_count, 0);

  const activeTopics = new Set(candidates.filter((c) => c.is_shortlisted).map((c) => c.keyword)).size;

  const audienceScale7d =
    threadsRows.reduce((sum, r) => sum + threadsEngagementTotal(r), 0) +
    facebookRows.reduce((sum, r) => sum + facebookEngagementTotal(r), 0);

  return { buzzVolume7d, activeTopics, audienceScale7d };
}
