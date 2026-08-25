import { describe, it, expect } from 'vitest';
import { computeBuzzTrend } from '../lib/buzz-trend';
import type { ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-18',
    keyword: 'k',
    category: 'du_lich',
    total_like_count: 0,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 4,
    ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-19',
    category: 'giai_tri',
    total_like_count: 0,
    total_comment_count: 0,
    total_share_count: 0,
    post_count: 2,
    ...overrides,
  };
}

describe('computeBuzzTrend', () => {
  it('produces one point per date in `dates`, even for dates with zero data', () => {
    const result = computeBuzzTrend([], [], [], ['2026-08-18', '2026-08-19']);
    expect(result).toEqual([
      { date: '2026-08-18', tai_chinh: 0, giai_tri: 0, du_lich: 0 },
      { date: '2026-08-19', tai_chinh: 0, giai_tri: 0, du_lich: 0 },
    ]);
  });

  it('weights each source using the same rule as the donut chart, grouped per day', () => {
    const result = computeBuzzTrend(
      [
        { categories: ['tai_chinh', 'giai_tri'], date: '2026-08-18' },
        { categories: ['tai_chinh'], date: '2026-08-19' },
      ],
      [threadsRow({ date: '2026-08-18', category: 'du_lich', post_count: 4 })],
      [facebookRow({ date: '2026-08-19', category: 'giai_tri', post_count: 2 })],
      ['2026-08-18', '2026-08-19']
    );
    expect(result[0]).toEqual({ date: '2026-08-18', tai_chinh: 0.5, giai_tri: 0.5, du_lich: 4 });
    expect(result[1]).toEqual({ date: '2026-08-19', tai_chinh: 1, giai_tri: 2, du_lich: 0 });
  });

  it('ignores rows whose date is not in the requested dates array', () => {
    const result = computeBuzzTrend(
      [{ categories: ['tai_chinh'], date: '2026-08-20' }],
      [],
      [],
      ['2026-08-18']
    );
    expect(result[0].tai_chinh).toBe(0);
  });
});
