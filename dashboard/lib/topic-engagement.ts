import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic, ThreadsEngagementDaily } from './types';
export interface TopicEngagement {
  totalEngagement: number; // like+reply+repost+quote+share, view_count excluded
  postCount: number;
}

export interface EnrichedHotTopicRow extends HotTopicRow {
  engagement: TopicEngagement | null;
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
  engagementByKeyword: Map<string, ThreadsEngagementDaily>
): EnrichedHotTopicRow[] {
  return rows.map((row) => {
    const engagementRow = engagementByKeyword.get(row.keyword);
    if (!engagementRow) {
      return { ...row, engagement: null };
    }
    return {
      ...row,
      engagement: {
        totalEngagement: threadsEngagementTotal(engagementRow),
        postCount: engagementRow.post_count,
      },
    };
  });
}

// Fallback for when the Threads engagement fetch fails or there's no date
// to query yet — every row gets engagement: null, same shape as if
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
