import { describe, it, expect } from 'vitest';
import { computeBuzzByPlatform } from '../lib/buzz-by-platform';
import type { ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24', keyword: 'a', category: 'tai_chinh', total_like_count: 0, total_reply_count: 0,
    total_repost_count: 0, total_quote_count: 0, total_share_count: 0, total_view_count: 0, post_count: 1, ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return { date: '2026-08-24', category: 'tai_chinh', total_like_count: 0, total_comment_count: 0, total_share_count: 0, post_count: 1, ...overrides };
}

describe('computeBuzzByPlatform', () => {
  it('returns 3 fixed platforms summing to exactly 100%', () => {
    const result = computeBuzzByPlatform(
      [{ categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }], // 3 articles
      [threadsRow({ post_count: 3 })], // 3 threads posts
      [facebookRow({ post_count: 4 })] // 4 facebook posts
    );
    expect(result.map((r) => r.label)).toEqual(['Báo điện tử', 'Threads', 'Facebook']);
    const total = result.reduce((sum, r) => sum + r.pct, 0);
    expect(total).toBe(100);
    // 3/10=30%, 3/10=30%, 4/10=40% — no rounding remainder to distribute
    expect(result.map((r) => r.pct)).toEqual([30, 30, 40]);
  });

  it('returns all zeros when there is no data at all', () => {
    const result = computeBuzzByPlatform([], [], []);
    expect(result.every((r) => r.pct === 0)).toBe(true);
  });
});
