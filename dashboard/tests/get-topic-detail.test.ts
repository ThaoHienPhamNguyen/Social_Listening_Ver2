import { describe, it, expect } from 'vitest';
import { getTopicDetail } from '../lib/get-topic-detail';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeThreadsSentimentReader } from './fakes/fake-threads-sentiment-reader';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'c-1',
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

describe('getTopicDetail', () => {
  it('fetches the 7-day range ending on latestDate and filters engagement/sentiment rows to the requested keyword', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      candidate({ keyword: 'bitcoin', date: '2026-08-24' }),
      candidate({ keyword: 'bitcoin', date: '2026-08-17' }), // out of range
    ]);
    const threadsReader = new FakeThreadsEngagementReader([
      {
        date: '2026-08-24', keyword: 'bitcoin', category: 'tai_chinh',
        total_like_count: 10, total_reply_count: 0, total_repost_count: 0,
        total_quote_count: 0, total_share_count: 0, total_view_count: 0, post_count: 1,
      },
      {
        date: '2026-08-24', keyword: 'ethereum', category: 'tai_chinh',
        total_like_count: 999, total_reply_count: 0, total_repost_count: 0,
        total_quote_count: 0, total_share_count: 0, total_view_count: 0, post_count: 1,
      },
    ]);
    const sentimentReader = new FakeThreadsSentimentReader([
      { date: '2026-08-24', keyword: 'bitcoin', sentiment: 'positive' },
      { date: '2026-08-24', keyword: 'ethereum', sentiment: 'negative' },
    ]);

    const result = await getTopicDetail(candidateReader, threadsReader, sentimentReader, 'bitcoin', '2026-08-24');

    expect(result?.trendingScoreTimeline).toHaveLength(7);
    expect(result?.trendingScoreTimeline[6]).toEqual({ date: '2026-08-24', score: 50 });
    expect(result?.engagementTimeline[6].totalEngagement).toBe(10);
    expect(result?.sentimentTimeline[6]).toEqual({ date: '2026-08-24', positive: 1, negative: 0, neutral: 0 });
  });
});
