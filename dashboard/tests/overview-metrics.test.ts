import { describe, it, expect } from 'vitest';
import { computeOverviewMetrics, computeDonutSegments, computeKpiDelta } from '../lib/overview-metrics';
import type { CandidateTopic, ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-24',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 10,
    total_reply_count: 1,
    total_repost_count: 2,
    total_quote_count: 0,
    total_share_count: 3,
    total_view_count: 100,
    post_count: 2,
    ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-24',
    category: 'giai_tri',
    total_like_count: 5,
    total_comment_count: 1,
    total_share_count: 1,
    post_count: 3,
    ...overrides,
  };
}

describe('computeOverviewMetrics', () => {
  it('sums buzz volume from article count + Threads/Facebook post counts', () => {
    const result = computeOverviewMetrics(
      [],
      [{ categories: ['tai_chinh'] }, { categories: [] }],
      [threadsRow({ post_count: 2 })],
      [facebookRow({ post_count: 3 })],
      []
    );
    expect(result.buzzVolume).toBe(7); // 2 articles + 2 threads posts + 3 facebook posts
  });

  it('counts distinct shortlisted keywords for topicsTrending, ignoring duplicates and non-shortlisted', () => {
    const result = computeOverviewMetrics(
      [
        candidate({ id: 'a', keyword: 'bitcoin', source: 'google_trends', is_shortlisted: true }),
        candidate({ id: 'b', keyword: 'bitcoin', source: 'youtube', is_shortlisted: true }),
        candidate({ id: 'c', keyword: 'ethereum', source: 'rss', is_shortlisted: false }),
      ],
      [],
      [],
      [],
      []
    );
    expect(result.topicsTrending).toBe(1);
  });

  it('sums audience scale from Threads + Facebook engagement totals', () => {
    const result = computeOverviewMetrics([], [], [threadsRow()], [facebookRow()], []);
    expect(result.audienceScale).toBe(23); // 16 (threads) + 7 (facebook)
  });

  it('computes an overall sentiment score across all rows regardless of keyword/category', () => {
    const result = computeOverviewMetrics(
      [],
      [],
      [],
      [],
      [{ sentiment: 'positive' }, { sentiment: 'positive' }, { sentiment: 'negative' }]
    );
    expect(result.sentimentScore).toBe(33);
  });

  it('returns null sentimentScore when no rows are classified', () => {
    const result = computeOverviewMetrics([], [], [], [], []);
    expect(result.sentimentScore).toBeNull();
  });
});

describe('computeDonutSegments', () => {
  it('splits a multi-category article fractionally across its categories', () => {
    const result = computeDonutSegments([{ categories: ['tai_chinh', 'giai_tri'] }], [], []);
    expect(result.find((s) => s.category === 'tai_chinh')?.pct).toBe(50);
    expect(result.find((s) => s.category === 'giai_tri')?.pct).toBe(50);
  });

  it('excludes articles with no categories from the denominator', () => {
    const result = computeDonutSegments([{ categories: ['tai_chinh'] }, { categories: [] }], [], []);
    expect(result.find((s) => s.category === 'tai_chinh')?.pct).toBe(100);
  });

  it('excludes Threads rows with a null category, weights Facebook rows fully by post_count', () => {
    const result = computeDonutSegments(
      [],
      [threadsRow({ category: null, post_count: 99 }), threadsRow({ category: 'tai_chinh', post_count: 1 })],
      [facebookRow({ category: 'giai_tri', post_count: 1 })]
    );
    expect(result.find((s) => s.category === 'tai_chinh')?.pct).toBe(50);
    expect(result.find((s) => s.category === 'giai_tri')?.pct).toBe(50);
  });

  it('returns 0% for every category (all 3 always present) when there is no weighted data at all', () => {
    const result = computeDonutSegments([], [], []);
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.pct === 0)).toBe(true);
  });

  it('uses largest-remainder rounding so percentages always sum to exactly 100 (three equal thirds)', () => {
    const result = computeDonutSegments(
      [],
      [
        threadsRow({ category: 'tai_chinh', post_count: 1 }),
        threadsRow({ category: 'giai_tri', post_count: 1 }),
      ],
      [facebookRow({ category: 'du_lich', post_count: 1 })]
    );
    const total = result.reduce((sum, s) => sum + s.pct, 0);
    expect(total).toBe(100);
  });
});

describe('computeKpiDelta', () => {
  it('formats a positive change with an up arrow and rounded percent', () => {
    const result = computeKpiDelta(120, 100);
    expect(result).toEqual({ text: '▲ +20% so với 7 ngày trước', positive: true });
  });

  it('formats a negative change with a down arrow', () => {
    const result = computeKpiDelta(80, 100);
    expect(result).toEqual({ text: '▼ -20% so với 7 ngày trước', positive: false });
  });

  it('falls back to a no-data message when prev is 0', () => {
    const result = computeKpiDelta(50, 0);
    expect(result).toEqual({ text: 'Chưa có dữ liệu 7 ngày trước', positive: true });
  });
});
