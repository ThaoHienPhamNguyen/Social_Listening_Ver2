import { describe, it, expect } from 'vitest';
import { enrichHotTopicsWithThreadsData } from '../lib/get-topic-engagement';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeThreadsSentimentReader } from './fakes/fake-threads-sentiment-reader';
import type { HotTopicRow } from '../lib/hot-topics';

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

describe('enrichHotTopicsWithThreadsData', () => {
  it('attaches engagement to matching rows across every source group', async () => {
    const bySource = {
      google_trends: [hotTopicRow({ id: 'a', source: 'google_trends', keyword: 'bitcoin' })],
      youtube: [hotTopicRow({ id: 'b', source: 'youtube', keyword: 'ethereum' })],
      rss: [] as HotTopicRow[],
    };
    const engagementReader = new FakeThreadsEngagementReader([
      {
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
      },
    ]);
    const sentimentReader = new FakeThreadsSentimentReader([
      { date: '2026-08-24', keyword: 'bitcoin', sentiment: 'positive' },
    ]);

    const result = await enrichHotTopicsWithThreadsData(bySource, engagementReader, sentimentReader, '2026-08-24');

    expect(result.google_trends[0].engagement?.totalEngagement).toBe(10);
    expect(result.google_trends[0].engagement?.sentimentIndex).toBe(100);
    expect(result.youtube[0].engagement).toBeNull();
    expect(result.rss).toEqual([]);
  });

  it('only pulls data for the given date', async () => {
    const bySource = { google_trends: [hotTopicRow({ keyword: 'bitcoin' })], youtube: [], rss: [] };
    const engagementReader = new FakeThreadsEngagementReader([
      {
        date: '2026-08-23',
        keyword: 'bitcoin',
        category: null,
        total_like_count: 10,
        total_reply_count: 0,
        total_repost_count: 0,
        total_quote_count: 0,
        total_share_count: 0,
        total_view_count: 0,
        post_count: 1,
      },
    ]);
    const sentimentReader = new FakeThreadsSentimentReader([]);

    const result = await enrichHotTopicsWithThreadsData(bySource, engagementReader, sentimentReader, '2026-08-24');

    expect(result.google_trends[0].engagement).toBeNull();
  });
});
