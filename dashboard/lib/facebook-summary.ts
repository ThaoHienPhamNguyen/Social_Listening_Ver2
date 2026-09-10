import type { FacebookEngagementDaily } from './types';

export interface FacebookSummary {
  totalEngagement: number; // like+comment+share
  postCount: number;
}

export function facebookEngagementTotal(row: FacebookEngagementDaily): number {
  return row.total_like_count + row.total_comment_count + row.total_share_count;
}

export function buildFacebookSummary(
  category: string,
  engagementRows: FacebookEngagementDaily[]
): FacebookSummary | null {
  const engagementRow = engagementRows.find((r) => r.category === category);
  if (!engagementRow) return null;

  return {
    totalEngagement: facebookEngagementTotal(engagementRow),
    postCount: engagementRow.post_count,
  };
}
