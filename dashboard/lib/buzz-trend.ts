import { accumulateCategoryWeights } from './overview-metrics';
import { CATEGORIES } from './categories';
import type { ThreadsEngagementDaily, FacebookEngagementDaily } from './types';

export interface BuzzTrendPoint {
  date: string;
  [category: string]: number | string;
}

export function computeBuzzTrend(
  articles: { categories: string[]; date: string }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[],
  dates: string[]
): BuzzTrendPoint[] {
  return dates.map((date) => {
    const dayArticles = articles.filter((a) => a.date === date);
    const dayThreads = threadsRows.filter((r) => r.date === date);
    const dayFacebook = facebookRows.filter((r) => r.date === date);
    const weightByCategory = accumulateCategoryWeights(dayArticles, dayThreads, dayFacebook);

    const point: BuzzTrendPoint = { date };
    for (const c of CATEGORIES) {
      point[c.value] = weightByCategory.get(c.value) ?? 0;
    }
    return point;
  });
}
