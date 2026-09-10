import { describe, it, expect } from 'vitest';
import {
  attachEngagement,
  withoutEngagement,
  threadsEngagementTotal,
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

describe('attachEngagement', () => {
  it('attaches engagement when a matching keyword exists', () => {
    const rows = [hotTopicRow({ keyword: 'bitcoin' })];
    const engagementByKeyword = new Map([['bitcoin', engagementRow()]]);

    const result = attachEngagement(rows, engagementByKeyword);

    expect(result[0].engagement).toEqual({
      totalEngagement: 16, // 10+1+2+0+3, view_count excluded
      postCount: 2,
    });
  });

  it('sets engagement to null when no matching keyword exists', () => {
    const rows = [hotTopicRow({ keyword: 'ethereum' })];
    const result = attachEngagement(rows, new Map());
    expect(result[0].engagement).toBeNull();
  });

  it('preserves all original HotTopicRow fields', () => {
    const rows = [
      hotTopicRow({ id: 'xyz', source: 'youtube', keyword: 'bitcoin', metricValue: 99, trendingScore: 12, shareOfVoice: 4 }),
    ];
    const result = attachEngagement(rows, new Map());
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
      threads: [] as HotTopicRow[],
      facebook: [] as HotTopicRow[],
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

