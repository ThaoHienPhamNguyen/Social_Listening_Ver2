import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic, SentimentLabel, ThreadsEngagementDaily } from './types';

export interface SentimentCounts {
  positive: number;
  negative: number;
  neutral: number;
}

export interface TopicEngagement {
  totalEngagement: number; // like+reply+repost+quote+share, view_count excluded
  postCount: number;
  sentiment: SentimentCounts;
  sentimentIndex: number | null;
}

export interface EnrichedHotTopicRow extends HotTopicRow {
  engagement: TopicEngagement | null;
}

export function groupSentimentCounts(
  rows: { key: string; sentiment: SentimentLabel | null }[]
): Map<string, SentimentCounts> {
  const result = new Map<string, SentimentCounts>();
  for (const row of rows) {
    if (row.sentiment !== 'positive' && row.sentiment !== 'negative' && row.sentiment !== 'neutral') continue;
    const counts = result.get(row.key) ?? { positive: 0, negative: 0, neutral: 0 };
    counts[row.sentiment] += 1;
    result.set(row.key, counts);
  }
  return result;
}

// Adapted from ver1's lib/sentiment-index.ts: round((positive-negative)/total*100),
// thang -100..+100. Input here is a count of individual posts for one
// keyword/category on one day, rather than an average of per-day
// percentage records across a period — mathematically equivalent when
// every post carries equal weight.
export function computeSentimentIndex(counts: SentimentCounts): number | null {
  const total = counts.positive + counts.negative + counts.neutral;
  if (total === 0) return null;
  return Math.round(((counts.positive - counts.negative) / total) * 100);
}

// Same accumulation as groupSentimentCounts but into ONE bucket rather than
// grouped by key — used where a single overall sentiment figure is wanted
// (e.g. an Overview-wide Sentiment Score) rather than per-keyword/
// per-category counts.
export function countAllSentiment(rows: { sentiment: SentimentLabel | null }[]): SentimentCounts {
  const counts: SentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  for (const row of rows) {
    if (row.sentiment !== 'positive' && row.sentiment !== 'negative' && row.sentiment !== 'neutral') continue;
    counts[row.sentiment] += 1;
  }
  return counts;
}

export function threadsEngagementTotal(row: ThreadsEngagementDaily): number {
  return (
    row.total_like_count +
    row.total_reply_count +
    row.total_repost_count +
    row.total_quote_count +
    row.total_share_count
  );
}

export function attachEngagement(
  rows: HotTopicRow[],
  engagementByKeyword: Map<string, ThreadsEngagementDaily>,
  sentimentByKeyword: Map<string, SentimentCounts>
): EnrichedHotTopicRow[] {
  return rows.map((row) => {
    const engagementRow = engagementByKeyword.get(row.keyword);
    if (!engagementRow) {
      return { ...row, engagement: null };
    }
    const sentiment = sentimentByKeyword.get(row.keyword) ?? { positive: 0, negative: 0, neutral: 0 };
    return {
      ...row,
      engagement: {
        totalEngagement: threadsEngagementTotal(engagementRow),
        postCount: engagementRow.post_count,
        sentiment,
        sentimentIndex: computeSentimentIndex(sentiment),
      },
    };
  });
}

// Fallback for when the Threads engagement/sentiment fetch fails or there's
// no date to query yet — every row gets engagement: null, same shape as if
// attachEngagement had found no match for any keyword.
export function withoutEngagement(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>
): Record<CandidateTopic['source'], EnrichedHotTopicRow[]> {
  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const result = {} as Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
  for (const source of sources) {
    result[source] = bySource[source].map((row) => ({ ...row, engagement: null }));
  }
  return result;
}
