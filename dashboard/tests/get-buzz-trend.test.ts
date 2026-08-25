import { describe, it, expect } from 'vitest';
import { getBuzzTrend } from '../lib/get-buzz-trend';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import type { Article } from '../lib/types';

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a',
    url: 'u',
    title: 't',
    published_at: '2026-08-24T00:00:00Z',
    source_id: 's',
    categories: ['tai_chinh'],
    snippet: '',
    ...overrides,
  };
}

describe('getBuzzTrend', () => {
  it('queries the 7-day range ending on latestDate and returns 7 points in chronological order', async () => {
    const articlesReader = new FakeArticlesReader([
      article({ id: 'in', published_at: '2026-08-18T00:00:00Z' }),
      article({ id: 'out-before', published_at: '2026-08-17T00:00:00Z' }),
      article({ id: 'out-after', published_at: '2026-08-25T00:00:00Z' }),
    ]);
    const result = await getBuzzTrend(
      articlesReader,
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      '2026-08-24'
    );
    expect(result.map((p) => p.date)).toEqual([
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
      '2026-08-24',
    ]);
    expect(result[0].tai_chinh).toBe(1); // 'in' article counted on 2026-08-18
    expect(result.every((p) => p.date !== '2026-08-17' && p.date !== '2026-08-25')).toBe(true);
  });
});
