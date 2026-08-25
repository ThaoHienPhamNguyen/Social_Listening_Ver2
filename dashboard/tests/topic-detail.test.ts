import { describe, it, expect } from 'vitest';
import { computeTopicDetail } from '../lib/topic-detail';
import type { CandidateTopic, ThreadsEngagementDaily } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'c-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-18',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-18',
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

describe('computeTopicDetail', () => {
  it('returns null when there is no data at all for this keyword', () => {
    const result = computeTopicDetail('nonexistent', [], [], [], ['2026-08-18']);
    expect(result).toBeNull();
  });

  it('produces one timeline point per date, with null score on days with no candidate row', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [candidate({ date: '2026-08-18', metric_value: 10, growth_rate: 0.5 })],
      [],
      [],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.trendingScoreTimeline).toEqual([
      { date: '2026-08-17', score: null },
      { date: '2026-08-18', score: 50 },
    ]);
  });

  it('resolves score from the highest metric_value candidate when multiple sources share a day', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [
        candidate({ id: 'a', date: '2026-08-18', metric_value: 5, growth_rate: 0.1, source: 'rss' }),
        candidate({ id: 'b', date: '2026-08-18', metric_value: 20, growth_rate: 0.9, source: 'youtube' }),
      ],
      [],
      [],
      ['2026-08-18']
    );
    expect(result?.trendingScoreTimeline[0].score).toBe(90);
  });

  it('resolves category order-independently regardless of row order (regression, mirrors topic-movers.ts fix)', () => {
    const newestNoCategory = candidate({ date: '2026-08-19', category_hint: [] });
    const olderWithCategory = candidate({ date: '2026-08-18', category_hint: ['tai_chinh'] });

    const forward = computeTopicDetail('bitcoin', [newestNoCategory, olderWithCategory], [], [], []);
    const reversed = computeTopicDetail('bitcoin', [olderWithCategory, newestNoCategory], [], [], []);

    expect(forward?.category).toBe('tai_chinh');
    expect(reversed?.category).toBe('tai_chinh');
  });

  it('collects distinct sources in first-seen order', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [
        candidate({ date: '2026-08-18', source: 'rss' }),
        candidate({ date: '2026-08-19', source: 'youtube' }),
        candidate({ date: '2026-08-20', source: 'rss' }),
      ],
      [],
      [],
      []
    );
    expect(result?.sources).toEqual(['rss', 'youtube']);
  });

  it('sums engagement per day across multiple rows and defaults to 0 on days with none', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [],
      [
        threadsRow({ date: '2026-08-18', total_like_count: 10, post_count: 1 }),
        threadsRow({ date: '2026-08-18', total_like_count: 5, post_count: 1 }),
      ],
      [],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.engagementTimeline).toEqual([
      { date: '2026-08-17', totalEngagement: 0, postCount: 0 },
      { date: '2026-08-18', totalEngagement: 15, postCount: 2 },
    ]);
  });

  it('counts sentiment per day, ignoring null sentiment, defaulting to zero counts on days with none', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [candidate({ date: '2026-08-18' })],
      [],
      [
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: 'positive' },
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: 'positive' },
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: 'negative' },
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: null },
      ],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.sentimentTimeline).toEqual([
      { date: '2026-08-17', positive: 0, negative: 0, neutral: 0 },
      { date: '2026-08-18', positive: 2, negative: 1, neutral: 0 },
    ]);
  });
});
