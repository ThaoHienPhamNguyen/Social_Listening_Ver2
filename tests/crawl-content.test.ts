import { describe, it, expect } from 'vitest';
import { crawlPendingArticles, MAX_FETCH_ATTEMPTS } from '../src/crawl-content';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import type { ContentExtractor } from '../src/lib/article-extractor';
import type { Article } from '../src/types';

function baseArticle(overrides: Partial<Article>): Article {
  return {
    id: '1',
    url: 'https://example.com/a',
    title: 't',
    published_at: '',
    source_id: 's',
    categories: [],
    snippet: '',
    full_content: null,
    content_fetch_status: 'pending',
    fetch_attempts: 0,
    ...overrides,
  };
}

describe('crawlPendingArticles', () => {
  it('marks an article done when extraction succeeds', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1' }));
    const extractor: ContentExtractor = { extract: async () => ({ text: 'nội dung đầy đủ' }) };

    const result = await crawlPendingArticles({ repo, extractor });

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(repo.articles[0].content_fetch_status).toBe('done');
    expect(repo.articles[0].full_content).toBe('nội dung đầy đủ');
  });

  it('keeps status pending and increments attempts when extraction fails, under the cap', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1', fetch_attempts: 0 }));
    const extractor: ContentExtractor = { extract: async () => null };

    const result = await crawlPendingArticles({ repo, extractor });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(repo.articles[0].content_fetch_status).toBe('pending');
    expect(repo.articles[0].fetch_attempts).toBe(1);
  });

  it('marks failed permanently once attempts reach MAX_FETCH_ATTEMPTS', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1', fetch_attempts: MAX_FETCH_ATTEMPTS - 1 }));
    const extractor: ContentExtractor = {
      extract: async () => {
        throw new Error('timeout');
      },
    };

    await crawlPendingArticles({ repo, extractor });

    expect(repo.articles[0].content_fetch_status).toBe('failed');
    expect(repo.articles[0].fetch_attempts).toBe(MAX_FETCH_ATTEMPTS);
  });

  it('respects the limit parameter', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1' }), baseArticle({ id: '2', url: 'https://example.com/b' }));
    const extractor: ContentExtractor = { extract: async () => ({ text: 'x' }) };

    const result = await crawlPendingArticles({ repo, extractor }, 1);

    expect(result.processed).toBe(1);
  });
});
