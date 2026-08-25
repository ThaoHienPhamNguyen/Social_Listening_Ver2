import { describe, it, expect } from 'vitest';
import { computeTopicMovers } from '../lib/topic-movers';
import type { ThreadsEngagementDaily } from '../lib/types';

function row(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 10,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 1,
    ...overrides,
  };
}

describe('computeTopicMovers', () => {
  it('ranks gainers by deltaPct descending', () => {
    const current = [row({ keyword: 'a', total_like_count: 20 }), row({ keyword: 'b', total_like_count: 10 })];
    const previous = [row({ keyword: 'a', total_like_count: 10 }), row({ keyword: 'b', total_like_count: 10 })];
    const { gainers } = computeTopicMovers(current, previous);
    expect(gainers.map((g) => g.keyword)).toEqual(['a', 'b']);
    expect(gainers[0].deltaPct).toBe(100);
    expect(gainers[1].deltaPct).toBe(0);
  });

  it('treats a brand-new keyword (no previous rows) as +100%', () => {
    const { gainers } = computeTopicMovers([row({ keyword: 'new', total_like_count: 5 })], []);
    expect(gainers[0]).toMatchObject({ keyword: 'new', deltaPct: 100 });
  });

  it('excludes a keyword with zero buzz in both periods', () => {
    const current = [
      row({
        keyword: 'a',
        total_like_count: 0,
        total_reply_count: 0,
        total_repost_count: 0,
        total_quote_count: 0,
        total_share_count: 0,
      }),
    ];
    const { gainers, losers } = computeTopicMovers(current, []);
    expect(gainers).toHaveLength(0);
    expect(losers).toHaveLength(0);
  });

  it('excludes a keyword whose rows never carry a category, in either period', () => {
    const current = [row({ keyword: 'a', category: null })];
    const { gainers } = computeTopicMovers(current, []);
    expect(gainers).toHaveLength(0);
  });

  it('sums engagement (not post_count) across multiple rows for the same keyword in one period', () => {
    const current = [
      row({ keyword: 'a', total_like_count: 10, total_reply_count: 0 }),
      row({ keyword: 'a', total_like_count: 5, total_reply_count: 1 }),
    ];
    const { gainers } = computeTopicMovers(current, []);
    expect(gainers[0].buzz).toBe(16); // 10+5 likes + 1 reply
  });

  it('falls back to true losers (deltaPct < 0) when any exist, sorted ascending', () => {
    const current = [row({ keyword: 'up', total_like_count: 20 }), row({ keyword: 'down', total_like_count: 5 })];
    const previous = [row({ keyword: 'up', total_like_count: 10 }), row({ keyword: 'down', total_like_count: 10 })];
    const { losers, hasRealLosers } = computeTopicMovers(current, previous);
    expect(hasRealLosers).toBe(true);
    expect(losers.map((l) => l.keyword)).toEqual(['down']);
  });

  it('falls back to the slowest-growing topics when no true losers exist', () => {
    const current = [row({ keyword: 'fast', total_like_count: 30 }), row({ keyword: 'slow', total_like_count: 11 })];
    const previous = [row({ keyword: 'fast', total_like_count: 10 }), row({ keyword: 'slow', total_like_count: 10 })];
    const { losers, hasRealLosers } = computeTopicMovers(current, previous);
    expect(hasRealLosers).toBe(false);
    expect(losers[0].keyword).toBe('slow');
  });

  it('a keyword with buzz only in the previous period (vanished this period) still resolves a category and shows -100%', () => {
    const previous = [row({ keyword: 'gone', category: 'du_lich', total_like_count: 10 })];
    const { losers } = computeTopicMovers([], previous);
    expect(losers[0]).toMatchObject({ keyword: 'gone', category: 'du_lich', deltaPct: -100 });
  });

  it('caps gainers and losers at 5 entries each', () => {
    const current = Array.from({ length: 8 }, (_, i) => row({ keyword: `k${i}`, total_like_count: 10 + i }));
    const { gainers } = computeTopicMovers(current, []);
    expect(gainers).toHaveLength(5);
  });
});
