import { computeTrendingScore } from './hot-topics';
import { threadsEngagementTotal } from './topic-engagement';
import type { CandidateTopic, ThreadsEngagementDaily } from './types';

export interface TopicDetailData {
  keyword: string;
  category: string | null;
  sources: CandidateTopic['source'][];
  trendingScoreTimeline: { date: string; score: number | null }[];
  engagementTimeline: { date: string; totalEngagement: number; postCount: number }[];
}

// Order-independent category resolution — same approach as topic-movers.ts's
// aggregateByKeyword fix (final review, sub-project B): track the date of
// whichever row last supplied a non-empty category_hint, independent of
// array/query order, so results don't depend on which row Supabase happens
// to return first.
function resolveCategory(candidateHistory: CandidateTopic[]): string | null {
  let category: string | null = null;
  let categoryDate: string | null = null;
  for (const c of candidateHistory) {
    const candidateCategory = c.category_hint[0] ?? null;
    if (candidateCategory === null) continue;
    if (categoryDate === null || c.date >= categoryDate) {
      category = candidateCategory;
      categoryDate = c.date;
    }
  }
  return category;
}

function resolveSources(candidateHistory: CandidateTopic[]): CandidateTopic['source'][] {
  const seen = new Set<CandidateTopic['source']>();
  const result: CandidateTopic['source'][] = [];
  for (const c of candidateHistory) {
    if (!seen.has(c.source)) {
      seen.add(c.source);
      result.push(c.source);
    }
  }
  return result;
}

export function computeTopicDetail(
  keyword: string,
  candidateHistory: CandidateTopic[],
  threadsEngagementRows: ThreadsEngagementDaily[],
  dates: string[]
): TopicDetailData | null {
  if (candidateHistory.length === 0 && threadsEngagementRows.length === 0) {
    return null;
  }

  const trendingScoreTimeline = dates.map((date) => {
    const dayCandidates = candidateHistory.filter((c) => c.date === date);
    if (dayCandidates.length === 0) return { date, score: null };
    const best = dayCandidates.reduce((max, c) => (c.metric_value > max.metric_value ? c : max));
    return { date, score: computeTrendingScore(best) };
  });

  const engagementTimeline = dates.map((date) => {
    const dayRows = threadsEngagementRows.filter((r) => r.date === date);
    return {
      date,
      totalEngagement: dayRows.reduce((sum, r) => sum + threadsEngagementTotal(r), 0),
      postCount: dayRows.reduce((sum, r) => sum + r.post_count, 0),
    };
  });

  return {
    keyword,
    category: resolveCategory(candidateHistory),
    sources: resolveSources(candidateHistory),
    trendingScoreTimeline,
    engagementTimeline,
  };
}
