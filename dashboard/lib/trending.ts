import type { EnrichedHotTopicRow } from './topic-engagement';
import type { CandidateTopic } from './types';

// Gộp bySource (dùng cho Overview/sector pages, chia theo 3 nguồn) thành 1
// mảng duy nhất cho Trending Now — sort theo trendingScore desc (null cuối
// cùng), rồi theo metricValue desc khi trendingScore bằng nhau hoặc đều null.
export function flattenAndRankHotTopics(
  bySource: Record<CandidateTopic['source'], EnrichedHotTopicRow[]>
): EnrichedHotTopicRow[] {
  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const all = sources.flatMap((source) => bySource[source]);
  return [...all].sort((a, b) => {
    if (a.trendingScore === null && b.trendingScore === null) return b.metricValue - a.metricValue;
    if (a.trendingScore === null) return 1;
    if (b.trendingScore === null) return -1;
    if (a.trendingScore !== b.trendingScore) return b.trendingScore - a.trendingScore;
    return b.metricValue - a.metricValue;
  });
}
