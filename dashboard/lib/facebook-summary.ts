import { computeSentimentIndex, type SentimentCounts } from './topic-engagement';
import type { FacebookEngagementDaily } from './types';

export interface FacebookSummary {
  totalEngagement: number; // like+comment+share
  postCount: number;
  sentiment: SentimentCounts;
  sentimentIndex: number | null;
}

export function facebookEngagementTotal(row: FacebookEngagementDaily): number {
  return row.total_like_count + row.total_comment_count + row.total_share_count;
}

export function buildFacebookSummary(
  category: string,
  engagementRows: FacebookEngagementDaily[],
  sentimentByCategory: Map<string, SentimentCounts>
): FacebookSummary | null {
  const engagementRow = engagementRows.find((r) => r.category === category);
  if (!engagementRow) return null;

  const sentiment = sentimentByCategory.get(category) ?? { positive: 0, negative: 0, neutral: 0 };
  return {
    totalEngagement: facebookEngagementTotal(engagementRow),
    postCount: engagementRow.post_count,
    sentiment,
    sentimentIndex: computeSentimentIndex(sentiment),
  };
}
