import { describe, it, expect } from 'vitest';
import { ingestSource, ingestAllSources } from '../src/ingest-rss';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import type { RssSource } from '../src/types';
import type { FeedFetcher } from '../src/lib/rss-fetcher';

const source: RssSource = {
  id: 'test-source',
  name: 'Test Source',
  url: 'https://example.com/rss',
  defaultCategory: 'giai_tri',
};

function fakeFetcher(items: Array<Record<string, string>>): FeedFetcher {
  return { parseURL: async () => ({ items }) };
}

describe('ingestSource', () => {
  it('upserts one article per valid feed item, tagged pending', async () => {
    const repo = new FakeArticleRepository();
    const fetcher = fakeFetcher([
      { link: 'https://example.com/1', title: 'Ca sĩ ra mắt MV mới', contentSnippet: 'tóm tắt', isoDate: '2026-08-20T00:00:00Z' },
    ]);

    const result = await ingestSource(source, { fetcher, repo });

    expect(result.errors).toEqual([]);
    expect(result.fetched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(repo.articles).toHaveLength(1);
    expect(repo.articles[0]).toMatchObject({
      url: 'https://example.com/1',
      source_id: 'test-source',
      content_fetch_status: 'pending',
      fetch_attempts: 0,
      categories: ['giai_tri'],
    });
  });

  it('skips items missing a link or a title', async () => {
    const repo = new FakeArticleRepository();
    const fetcher = fakeFetcher([
      { title: 'Không có link' },
      { link: 'https://example.com/2' },
    ]);

    const result = await ingestSource(source, { fetcher, repo });

    expect(result.upserted).toBe(0);
    expect(repo.articles).toHaveLength(0);
  });

  it('skips items whose link is not an http(s) URL', async () => {
    const repo = new FakeArticleRepository();
    const fetcher = fakeFetcher([
      { link: 'javascript:alert(1)', title: 'Link độc hại' },
      { link: 'ftp://example.com/x', title: 'Không phải http(s)' },
      { link: 'https://example.com/good', title: 'Link hợp lệ' },
    ]);

    const result = await ingestSource(source, { fetcher, repo });

    expect(result.upserted).toBe(1);
    expect(repo.articles).toHaveLength(1);
    expect(repo.articles[0].url).toBe('https://example.com/good');
  });

  it('records an error and returns early when the feed fetch throws', async () => {
    const repo = new FakeArticleRepository();
    const fetcher: FeedFetcher = {
      parseURL: async () => {
        throw new Error('network down');
      },
    };

    const result = await ingestSource(source, { fetcher, repo });

    expect(result.fetched).toBe(0);
    expect(result.errors[0]).toContain('network down');
  });
});

describe('ingestAllSources', () => {
  it('runs ingestSource for every source and aggregates results', async () => {
    const repo = new FakeArticleRepository();
    const fetcher = fakeFetcher([{ link: 'https://example.com/x', title: 'Tiêu đề' }]);
    const sources: RssSource[] = [
      { ...source, id: 'source-a' },
      { ...source, id: 'source-b' },
    ];

    const results = await ingestAllSources(sources, { fetcher, repo });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.sourceId)).toEqual(['source-a', 'source-b']);
  });
});
