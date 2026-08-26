import { describe, it, expect } from 'vitest';
import { getOverviewMetrics } from '../lib/get-overview-metrics';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import { FakeThreadsSentimentReader } from './fakes/fake-threads-sentiment-reader';
import { FakeFacebookSentimentReader } from './fakes/fake-facebook-sentiment-reader';
import type { Article } from '../lib/types';

describe('getOverviewMetrics', () => {
  it('combines all 6 readers into metrics + donut for the given date', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      { id: 'a', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 1, growth_rate: 0, category_hint: ['tai_chinh'], is_shortlisted: true },
    ]);
    const articlesReader = new FakeArticlesReader([
      {
        id: 'art-1',
        url: 'https://x',
        title: 'x',
        published_at: '2026-08-24T10:00:00Z',
        source_id: 's',
        categories: ['tai_chinh'],
        snippet: '',
      } as Article,
    ]);
    const threadsEngagementReader = new FakeThreadsEngagementReader([
      {
        date: '2026-08-24',
        keyword: 'bitcoin',
        category: 'tai_chinh',
        total_like_count: 1,
        total_reply_count: 0,
        total_repost_count: 0,
        total_quote_count: 0,
        total_share_count: 0,
        total_view_count: 0,
        post_count: 1,
      },
    ]);
    const facebookEngagementReader = new FakeFacebookEngagementReader([]);
    const threadsSentimentReader = new FakeThreadsSentimentReader([
      { date: '2026-08-24', keyword: 'bitcoin', sentiment: 'positive' },
    ]);
    const facebookSentimentReader = new FakeFacebookSentimentReader([]);

    const result = await getOverviewMetrics(
      candidateReader,
      articlesReader,
      threadsEngagementReader,
      facebookEngagementReader,
      threadsSentimentReader,
      facebookSentimentReader,
      '2026-08-24'
    );

    expect(result.metrics.buzzVolume).toBe(2); // 1 article + 1 threads post
    expect(result.metrics.topicsTrending).toBe(1);
    expect(result.metrics.sentimentScore).toBe(100);
    expect(result.donut.find((s) => s.category === 'tai_chinh')?.pct).toBe(100);
  });

  it('returns zero/null metrics when every reader has no data for the date', async () => {
    const result = await getOverviewMetrics(
      new FakeCandidateTopicsReader([]),
      new FakeArticlesReader([]),
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      new FakeThreadsSentimentReader([]),
      new FakeFacebookSentimentReader([]),
      '2026-08-24'
    );

    expect(result.metrics.buzzVolume).toBe(0);
    expect(result.metrics.sentimentScore).toBeNull();
  });

  it('computes week-over-week deltas by also fetching the date 7 days earlier', async () => {
    const articlesReader = new FakeArticlesReader([
      { id: 'cur-1', url: 'x', title: 'x', published_at: '2026-08-24T10:00:00Z', source_id: 's', categories: ['tai_chinh'], snippet: '' } as Article,
      { id: 'cur-2', url: 'x', title: 'x', published_at: '2026-08-24T11:00:00Z', source_id: 's', categories: ['tai_chinh'], snippet: '' } as Article,
      { id: 'prev-1', url: 'x', title: 'x', published_at: '2026-08-17T10:00:00Z', source_id: 's', categories: ['tai_chinh'], snippet: '' } as Article,
    ]);

    const result = await getOverviewMetrics(
      new FakeCandidateTopicsReader([]),
      articlesReader,
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      new FakeThreadsSentimentReader([]),
      new FakeFacebookSentimentReader([]),
      '2026-08-24'
    );

    // curr buzzVolume = 2 articles, prev (2026-08-17) = 1 article -> (2-1)/1*100 = 100%
    expect(result.deltas.buzzVolume.text).toBe('▲ +100% so với 7 ngày trước');
    expect(result.deltas.buzzVolume.positive).toBe(true);
  });
});
