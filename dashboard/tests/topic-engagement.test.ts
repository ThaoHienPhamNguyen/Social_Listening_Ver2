import { describe, it, expect } from 'vitest';
import {
  groupSentimentCounts,
  computeSentimentIndex,
  attachEngagement,
  withoutEngagement,
  threadsEngagementTotal,
  countAllSentiment,
} from '../lib/topic-engagement';
import type { HotTopicRow } from '../lib/hot-topics';
import type { ThreadsEngagementDaily } from '../lib/types';

function hotTopicRow(overrides: Partial<HotTopicRow> = {}): HotTopicRow {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    metricValue: 10,
    trendingScore: 5,
    shareOfVoice: 2,
    ...overrides,
  };
}

function engagementRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
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

describe('groupSentimentCounts', () => {
  it('counts positive/negative/neutral per key', () => {
    const result = groupSentimentCounts([
      { key: 'bitcoin', sentiment: 'positive' },
      { key: 'bitcoin', sentiment: 'positive' },
      { key: 'bitcoin', sentiment: 'negative' },
      { key: 'ethereum', sentiment: 'neutral' },
    ]);
    expect(result.get('bitcoin')).toEqual({ positive: 2, negative: 1, neutral: 0 });
    expect(result.get('ethereum')).toEqual({ positive: 0, negative: 0, neutral: 1 });
  });

  it('ignores null sentiment and unknown labels', () => {
    const result = groupSentimentCounts([
      { key: 'bitcoin', sentiment: null },
      { key: 'bitcoin', sentiment: 'happy' as any },
      { key: 'bitcoin', sentiment: 'positive' },
    ]);
    expect(result.get('bitcoin')).toEqual({ positive: 1, negative: 0, neutral: 0 });
  });
});

describe('computeSentimentIndex', () => {
  it('returns null when total is 0', () => {
    expect(computeSentimentIndex({ positive: 0, negative: 0, neutral: 0 })).toBeNull();
  });

  it('computes (positive-negative)/total*100, rounded', () => {
    expect(computeSentimentIndex({ positive: 6, negative: 2, neutral: 2 })).toBe(40);
  });

  it('returns a negative number when negative dominates', () => {
    expect(computeSentimentIndex({ positive: 1, negative: 4, neutral: 0 })).toBe(-60);
  });

  it('returns 0 when positive and negative are equal', () => {
    expect(computeSentimentIndex({ positive: 3, negative: 3, neutral: 4 })).toBe(0);
  });
});

describe('attachEngagement', () => {
  it('attaches engagement + sentiment index when a matching keyword exists', () => {
    const rows = [hotTopicRow({ keyword: 'bitcoin' })];
    const engagementByKeyword = new Map([['bitcoin', engagementRow()]]);
    const sentimentByKeyword = new Map([['bitcoin', { positive: 3, negative: 1, neutral: 1 }]]);

    const result = attachEngagement(rows, engagementByKeyword, sentimentByKeyword);

    expect(result[0].engagement).toEqual({
      totalEngagement: 16, // 10+1+2+0+3, view_count excluded
      postCount: 2,
      sentiment: { positive: 3, negative: 1, neutral: 1 },
      sentimentIndex: 40, // (3-1)/5*100
    });
  });

  it('sets engagement to null when no matching keyword exists', () => {
    const rows = [hotTopicRow({ keyword: 'ethereum' })];
    const result = attachEngagement(rows, new Map(), new Map());
    expect(result[0].engagement).toBeNull();
  });

  it('defaults sentiment to all-zero counts when engagement exists but no sentiment data does', () => {
    const rows = [hotTopicRow({ keyword: 'bitcoin' })];
    const engagementByKeyword = new Map([['bitcoin', engagementRow()]]);
    const result = attachEngagement(rows, engagementByKeyword, new Map());
    expect(result[0].engagement?.sentiment).toEqual({ positive: 0, negative: 0, neutral: 0 });
    expect(result[0].engagement?.sentimentIndex).toBeNull();
  });

  it('preserves all original HotTopicRow fields', () => {
    const rows = [
      hotTopicRow({ id: 'xyz', source: 'youtube', keyword: 'bitcoin', metricValue: 99, trendingScore: 12, shareOfVoice: 4 }),
    ];
    const result = attachEngagement(rows, new Map(), new Map());
    expect(result[0]).toMatchObject({
      id: 'xyz',
      source: 'youtube',
      keyword: 'bitcoin',
      metricValue: 99,
      trendingScore: 12,
      shareOfVoice: 4,
    });
  });
});

describe('withoutEngagement', () => {
  it('sets engagement to null for every row across every source group', () => {
    const bySource = {
      google_trends: [hotTopicRow({ id: 'a' })],
      youtube: [] as HotTopicRow[],
      rss: [hotTopicRow({ id: 'b' })],
    };
    const result = withoutEngagement(bySource);
    expect(result.google_trends[0].engagement).toBeNull();
    expect(result.youtube).toEqual([]);
    expect(result.rss[0].engagement).toBeNull();
  });
});

describe('threadsEngagementTotal', () => {
  it('sums like+reply+repost+quote+share, excluding view_count', () => {
    const total = threadsEngagementTotal(engagementRow({ total_view_count: 99999 }));
    expect(total).toBe(16); // 10+1+2+0+3, from the shared engagementRow() fixture above
  });
});

describe('countAllSentiment', () => {
  it('counts every classified row into one bucket, ignoring key/grouping', () => {
    const result = countAllSentiment([
      { sentiment: 'positive' },
      { sentiment: 'positive' },
      { sentiment: 'negative' },
      { sentiment: 'neutral' },
    ]);
    expect(result).toEqual({ positive: 2, negative: 1, neutral: 1 });
  });

  it('ignores null and unknown labels', () => {
    const result = countAllSentiment([{ sentiment: null }, { sentiment: 'happy' as any }, { sentiment: 'positive' }]);
    expect(result).toEqual({ positive: 1, negative: 0, neutral: 0 });
  });

  it('returns all-zero counts for an empty array', () => {
    expect(countAllSentiment([])).toEqual({ positive: 0, negative: 0, neutral: 0 });
  });
});
