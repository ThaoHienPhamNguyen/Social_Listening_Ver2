import type { CandidateTopic, FacebookEngagementDaily, SentimentLabel, ThreadsEngagementDaily } from './types';
import { countAllSentiment, computeSentimentIndex, threadsEngagementTotal } from './topic-engagement';
import { facebookEngagementTotal } from './facebook-summary';
import { CATEGORIES } from './categories';

export interface OverviewMetrics {
  buzzVolume: number;
  topicsTrending: number;
  audienceScale: number;
  sentimentScore: number | null;
}

export interface DonutSegment {
  category: string;
  label: string;
  pct: number;
}

export function computeOverviewMetrics(
  candidates: CandidateTopic[],
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[],
  sentimentRows: { sentiment: SentimentLabel | null }[]
): OverviewMetrics {
  const buzzVolume =
    articles.length +
    threadsRows.reduce((sum, r) => sum + r.post_count, 0) +
    facebookRows.reduce((sum, r) => sum + r.post_count, 0);

  const topicsTrending = new Set(
    candidates.filter((c) => c.is_shortlisted).map((c) => c.keyword)
  ).size;

  const audienceScale =
    threadsRows.reduce((sum, r) => sum + threadsEngagementTotal(r), 0) +
    facebookRows.reduce((sum, r) => sum + facebookEngagementTotal(r), 0);

  const sentimentScore = computeSentimentIndex(countAllSentiment(sentimentRows));

  return { buzzVolume, topicsTrending, audienceScale, sentimentScore };
}

export function computeKpiDelta(curr: number, prev: number): { text: string; positive: boolean } {
  if (prev === 0) return { text: 'Chưa có dữ liệu 7 ngày trước', positive: true };
  const pct = ((curr - prev) / prev) * 100;
  const up = pct >= 0;
  return { text: `${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(0)}% so với 7 ngày trước`, positive: up };
}

export function accumulateCategoryWeights(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): Map<string, number> {
  const weightByCategory = new Map<string, number>();
  const addWeight = (category: string, weight: number) => {
    weightByCategory.set(category, (weightByCategory.get(category) ?? 0) + weight);
  };

  for (const article of articles) {
    if (article.categories.length === 0) continue;
    const weight = 1 / article.categories.length;
    for (const category of article.categories) {
      addWeight(category, weight);
    }
  }
  for (const row of threadsRows) {
    if (row.category === null) continue;
    addWeight(row.category, row.post_count);
  }
  for (const row of facebookRows) {
    addWeight(row.category, row.post_count);
  }

  return weightByCategory;
}

export function computeDonutSegments(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): DonutSegment[] {
  const weightByCategory = accumulateCategoryWeights(articles, threadsRows, facebookRows);
  const total = [...weightByCategory.values()].reduce((sum, v) => sum + v, 0);

  if (total === 0) {
    return CATEGORIES.map((c) => ({ category: c.value, label: c.label, pct: 0 }));
  }

  // Largest-remainder rounding: independently rounding each category's
  // percentage can sum to 99 or 101 (e.g. three equal thirds each round to
  // 33, losing a point). Floor every value, then hand the leftover
  // percentage points to whichever categories had the largest fractional
  // remainder, so the legend always sums to exactly 100.
  const raw = CATEGORIES.map((c) => {
    const weight = weightByCategory.get(c.value) ?? 0;
    const exact = (weight / total) * 100;
    const floor = Math.floor(exact);
    return { category: c.value, label: c.label, floor, remainder: exact - floor };
  });

  const flooredSum = raw.reduce((sum, r) => sum + r.floor, 0);
  const remaining = 100 - flooredSum;
  const bonusCategories = new Set(
    [...raw].sort((a, b) => b.remainder - a.remainder).slice(0, remaining).map((r) => r.category)
  );

  return raw.map((r) => ({
    category: r.category,
    label: r.label,
    pct: r.floor + (bonusCategories.has(r.category) ? 1 : 0),
  }));
}
