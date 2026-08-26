import { groupSentimentCounts } from './topic-engagement';
import type { SentimentLabel } from './types';

export interface SentimentTrendPoint {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
}

// Aggregate, not category-scoped (unlike computeSentimentByCategory) —
// Analytics' "Xu hướng Sentiment" chart shows the whole product's sentiment
// mix per day, not broken down by category.
export function computeSentimentTrend(
  threadsSentimentRows: { date: string; sentiment: SentimentLabel | null }[],
  facebookSentimentRows: { date: string; sentiment: SentimentLabel | null }[],
  dates: string[]
): SentimentTrendPoint[] {
  const keyed = [
    ...threadsSentimentRows.map((r) => ({ key: r.date, sentiment: r.sentiment })),
    ...facebookSentimentRows.map((r) => ({ key: r.date, sentiment: r.sentiment })),
  ];
  const counted = groupSentimentCounts(keyed);
  return dates.map((date) => {
    const counts = counted.get(date) ?? { positive: 0, negative: 0, neutral: 0 };
    return { date, ...counts };
  });
}
