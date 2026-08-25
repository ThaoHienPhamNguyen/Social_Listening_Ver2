import { describe, it, expect } from 'vitest';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import type { Article, ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a-1',
    url: 'https://example.com',
    title: 't',
    published_at: '2026-08-20T10:00:00Z',
    source_id: 's-1',
    categories: ['tai_chinh'],
    snippet: '',
    ...overrides,
  };
}

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-20',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 1,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 1,
    ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-20',
    category: 'giai_tri',
    total_like_count: 1,
    total_comment_count: 0,
    total_share_count: 0,
    post_count: 1,
    ...overrides,
  };
}

describe('FakeArticlesReader.getForDateRange', () => {
  it('includes the start date, excludes the end date, and attaches a `date` field', async () => {
    const reader = new FakeArticlesReader([
      article({ id: 'in-start', published_at: '2026-08-18T00:00:00Z' }),
      article({ id: 'in-mid', published_at: '2026-08-19T23:59:59Z' }),
      article({ id: 'out-end', published_at: '2026-08-20T00:00:00Z' }),
      article({ id: 'out-before', published_at: '2026-08-17T23:59:59Z' }),
      article({ id: 'no-date', published_at: null }),
    ]);
    const result = await reader.getForDateRange('2026-08-18', '2026-08-20');
    expect(result.map((r) => r.id).sort()).toEqual(['in-mid', 'in-start']);
    expect(result.find((r) => r.id === 'in-start')?.date).toBe('2026-08-18');
  });
});

describe('FakeThreadsEngagementReader.getForDateRange', () => {
  it('filters rows to [startDate, endDateExclusive)', async () => {
    const reader = new FakeThreadsEngagementReader([
      threadsRow({ date: '2026-08-18' }),
      threadsRow({ date: '2026-08-19' }),
      threadsRow({ date: '2026-08-20' }),
    ]);
    const result = await reader.getForDateRange('2026-08-18', '2026-08-20');
    expect(result.map((r) => r.date).sort()).toEqual(['2026-08-18', '2026-08-19']);
  });
});

describe('FakeFacebookEngagementReader.getForDateRange', () => {
  it('filters rows to [startDate, endDateExclusive)', async () => {
    const reader = new FakeFacebookEngagementReader([
      facebookRow({ date: '2026-08-18' }),
      facebookRow({ date: '2026-08-19' }),
      facebookRow({ date: '2026-08-20' }),
    ]);
    const result = await reader.getForDateRange('2026-08-18', '2026-08-20');
    expect(result.map((r) => r.date).sort()).toEqual(['2026-08-18', '2026-08-19']);
  });
});
