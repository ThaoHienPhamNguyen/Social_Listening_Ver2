import { describe, it, expect } from 'vitest';
import { FakeTopicArticleDataRepository } from './fakes/fake-topic-article-data-repository';

describe('FakeTopicArticleDataRepository', () => {
  it('upsertLinks adds every row in the batch', async () => {
    const repo = new FakeTopicArticleDataRepository();
    const { error, count } = await repo.upsertLinks([
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/1', article_title: 'Giá vàng tăng', article_snippet: '' },
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/2', article_title: 'Vàng SJC vượt mốc', article_snippet: '' },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(2);
    expect(repo.links).toHaveLength(2);
  });

  it('upsertLinks returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeTopicArticleDataRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertLinks([
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/1', article_title: 't', article_snippet: '' },
    ]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.links).toHaveLength(0);
  });

  it('getArticlesForDate returns only rows matching that date', async () => {
    const repo = new FakeTopicArticleDataRepository();
    await repo.upsertLinks([
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/1', article_title: 't1', article_snippet: '' },
      { keyword: 'vàng', source: 'rss', date: '2026-10-03', article_url: 'https://a.com/2', article_title: 't2', article_snippet: '' },
    ]);
    const result = await repo.getArticlesForDate('2026-10-04');
    expect(result.map((r) => r.article_url)).toEqual(['https://a.com/1']);
  });
});
