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

export function computeDonutSegments(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): DonutSegment[] {
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

  const total = [...weightByCategory.values()].reduce((sum, v) => sum + v, 0);

  return CATEGORIES.map((c) => ({
    category: c.value,
    label: c.label,
    pct: total === 0 ? 0 : Math.round(((weightByCategory.get(c.value) ?? 0) / total) * 100),
  }));
}
