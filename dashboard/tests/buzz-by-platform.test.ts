import { describe, it, expect } from 'vitest';
import { computeBuzzByPlatform } from '../lib/buzz-by-platform';
import type { ThreadsEngagementDaily } from '../lib/types';

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24', keyword: 'a', category: 'tai_chinh', total_like_count: 0, total_reply_count: 0,
    total_repost_count: 0, total_quote_count: 0, total_share_count: 0, total_view_count: 0, post_count: 1, ...overrides,
  };
}

describe('computeBuzzByPlatform', () => {
  it('returns 2 fixed platforms summing to exactly 100%', () => {
    const result = computeBuzzByPlatform(
      [{ categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }], // 3 articles
      [threadsRow({ post_count: 3 })] // 3 threads posts
    );
    expect(result.map((r) => r.label)).toEqual(['Báo điện tử', 'Threads']);
    const total = result.reduce((sum, r) => sum + r.pct, 0);
    expect(total).toBe(100);
    // 3/6=50%, 3/6=50% — no rounding remainder to distribute
    expect(result.map((r) => r.pct)).toEqual([50, 50]);
  });

  it('returns all zeros when there is no data at all', () => {
    const result = computeBuzzByPlatform([], []);
    expect(result.every((r) => r.pct === 0)).toBe(true);
  });
});
