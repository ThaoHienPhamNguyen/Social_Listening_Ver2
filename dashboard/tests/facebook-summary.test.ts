import { describe, it, expect } from 'vitest';
import { buildFacebookSummary, facebookEngagementTotal } from '../lib/facebook-summary';
import type { FacebookEngagementDaily } from '../lib/types';

function engagementRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-24',
    category: 'tai_chinh',
    total_like_count: 10,
    total_comment_count: 3,
    total_share_count: 2,
    post_count: 5,
    ...overrides,
  };
}

describe('buildFacebookSummary', () => {
  it('builds a summary when a matching category row exists', () => {
    const result = buildFacebookSummary('tai_chinh', [engagementRow()]);
    expect(result).toEqual({
      totalEngagement: 15, // 10+3+2
      postCount: 5,
    });
  });

  it('returns null when no engagement row matches the category', () => {
    const result = buildFacebookSummary('du_lich', [engagementRow({ category: 'tai_chinh' })]);
    expect(result).toBeNull();
  });
});

describe('facebookEngagementTotal', () => {
  it('sums like+comment+share', () => {
    const total = facebookEngagementTotal(engagementRow());
    expect(total).toBe(15); // 10+3+2, from the shared engagementRow() fixture above
  });
});
