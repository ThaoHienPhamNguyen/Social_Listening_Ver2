import { describe, it, expect } from 'vitest';
import { getSectorMetrics } from '../lib/get-sector-metrics';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import type { Article, CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 10,
    growth_rate: 0.5, category_hint: ['tai_chinh'], is_shortlisted: true, ...overrides,
  };
}

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a1', url: 'x', title: 'x', published_at: '2026-08-24T10:00:00Z', source_id: 's',
    categories: ['tai_chinh'], snippet: '', ...overrides,
  } as Article;
}

describe('getSectorMetrics', () => {
  it('splits a 14-day fetch into current (last 7 days) vs previous window and computes deltas', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      candidate({ date: '2026-08-24' }), // current window
      candidate({ id: 'id-2', keyword: 'ethereum', date: '2026-08-17' }), // previous window
    ]);
    const articlesReader = new FakeArticlesReader([
      article({ id: 'cur-1', published_at: '2026-08-24T10:00:00Z' }),
      article({ id: 'cur-2', published_at: '2026-08-24T11:00:00Z' }),
      article({ id: 'prev-1', published_at: '2026-08-17T10:00:00Z' }),
    ]);
    const threadsReader = new FakeThreadsEngagementReader([]);
    const facebookReader = new FakeFacebookEngagementReader([]);

    const result = await getSectorMetrics(candidateReader, articlesReader, threadsReader, facebookReader, 'tai_chinh', '2026-08-24');

    expect(result.metrics.buzzVolume7d).toBe(2); // only current-window articles count
    expect(result.metrics.activeTopics).toBe(1); // only 'bitcoin' (current window)
    // curr=2, prev=1 -> (2-1)/1*100 = 100%
    expect(result.buzzVolumeDelta.text).toBe('▲ +100% so với 7 ngày trước');
  });

  it('ignores candidates and rows from a different category', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      candidate({ category_hint: ['giai_tri'] }),
    ]);
    const result = await getSectorMetrics(
      candidateReader,
      new FakeArticlesReader([]),
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      'tai_chinh',
      '2026-08-24'
    );
    expect(result.metrics.activeTopics).toBe(0);
  });
});
