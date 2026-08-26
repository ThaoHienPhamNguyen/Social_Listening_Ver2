import { describe, it, expect } from 'vitest';
import { computeSectorMetrics } from '../lib/sector-metrics';
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
    category: 'tai_chinh',
    total_like_count: 5,
    total_comment_count: 1,
    total_share_count: 1,
    post_count: 1,
    ...overrides,
  };
}

describe('computeSectorMetrics', () => {
  it('sums buzz volume across articles + threads + facebook post counts', () => {
    const result = computeSectorMetrics(
      [candidate()],
      [{ categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }],
      [threadsRow()],
      [facebookRow()]
    );
    expect(result.buzzVolume7d).toBe(5); // 2 articles + 2 threads posts + 1 facebook post = 5
  });

  it('counts distinct shortlisted keywords for activeTopics, ignoring non-shortlisted', () => {
    const result = computeSectorMetrics(
      [candidate({ keyword: 'a', is_shortlisted: true }), candidate({ keyword: 'a', date: '2026-08-25', is_shortlisted: true }), candidate({ keyword: 'b', is_shortlisted: false })],
      [],
      [],
      []
    );
    expect(result.activeTopics).toBe(1); // 'a' counted once, 'b' excluded (not shortlisted)
  });

  it('sums audience scale from threads + facebook engagement totals', () => {
    const result = computeSectorMetrics([], [], [threadsRow({ total_like_count: 10, total_reply_count: 0, total_repost_count: 0, total_quote_count: 0, total_share_count: 0 })], [facebookRow({ total_like_count: 5, total_comment_count: 0, total_share_count: 0 })]);
    expect(result.audienceScale7d).toBe(15); // 10 (threads like) + 5 (facebook like)
  });

  it('returns all zeros for empty input', () => {
    const result = computeSectorMetrics([], [], [], []);
    expect(result).toEqual({ buzzVolume7d: 0, activeTopics: 0, audienceScale7d: 0 });
  });
});
