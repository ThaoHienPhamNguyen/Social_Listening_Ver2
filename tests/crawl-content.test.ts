import { describe, it, expect, vi } from 'vitest';
import { crawlPendingArticles, MAX_FETCH_ATTEMPTS } from '../src/crawl-content';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import type { ContentExtractor } from '../src/lib/article-extractor';
import type { Article, RssSource } from '../src/types';

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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await crawlPendingArticles({ repo, extractor });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(repo.articles[0].content_fetch_status).toBe('pending');
    expect(repo.articles[0].fetch_attempts).toBe(1);

    errorSpy.mockRestore();
  });

  it('marks failed permanently once attempts reach MAX_FETCH_ATTEMPTS', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1', fetch_attempts: MAX_FETCH_ATTEMPTS - 1 }));
    const extractor: ContentExtractor = {
      extract: async () => {
        throw new Error('timeout');
      },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await crawlPendingArticles({ repo, extractor });

    expect(repo.articles[0].content_fetch_status).toBe('failed');
    expect(repo.articles[0].fetch_attempts).toBe(MAX_FETCH_ATTEMPTS);

    errorSpy.mockRestore();
  });

  it('respects the limit parameter', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1' }), baseArticle({ id: '2', url: 'https://example.com/b' }));
    const extractor: ContentExtractor = { extract: async () => ({ text: 'x' }) };

    const result = await crawlPendingArticles({ repo, extractor }, 1);

    expect(result.processed).toBe(1);
  });

  it('recomputes categories from full_content and unions them with the categories captured at ingest', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(
      baseArticle({ id: '1', source_id: 'src-tai-chinh', categories: ['giai_tri'] })
    );
    const sources: RssSource[] = [
      { id: 'src-tai-chinh', name: 'Test', url: 'https://example.com/rss', defaultCategory: 'tai_chinh' },
    ];
    const extractor: ContentExtractor = {
      extract: async () => ({ text: 'Bài viết dài về cổ phiếu và ngân hàng, không nhắc gì đến giải trí.' }),
    };

    await crawlPendingArticles({ repo, extractor, sources });

    expect(repo.articles[0].categories.sort()).toEqual(['giai_tri', 'tai_chinh'].sort());
  });

  it('does not duplicate a category already present after recompute', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(
      baseArticle({ id: '1', source_id: 'src-tai-chinh', categories: ['tai_chinh'] })
    );
    const sources: RssSource[] = [
      { id: 'src-tai-chinh', name: 'Test', url: 'https://example.com/rss', defaultCategory: 'tai_chinh' },
    ];
    const extractor: ContentExtractor = { extract: async () => ({ text: 'Nội dung chung chung.' }) };

    await crawlPendingArticles({ repo, extractor, sources });

    expect(repo.articles[0].categories).toEqual(['tai_chinh']);
  });

  it('keeps the ingest-time categories unchanged when the source_id is not in the configured sources list', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(
      baseArticle({ id: '1', source_id: 'unknown-source', categories: ['tai_chinh'] })
    );
    const sources: RssSource[] = [
      { id: 'src-tai-chinh', name: 'Test', url: 'https://example.com/rss', defaultCategory: 'tai_chinh' },
    ];
    const extractor: ContentExtractor = {
      extract: async () => ({ text: 'Ca sĩ ra mắt MV mới trong dịp lễ, showbiz sôi động.' }),
    };

    const result = await crawlPendingArticles({ repo, extractor, sources });

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(repo.articles[0].categories).toEqual(['tai_chinh']);
  });

  it('propagates the error when getPendingArticles fails, instead of treating it as nothing pending', async () => {
    const repo = new FakeArticleRepository();
    repo.getPendingArticlesError = 'connection refused';
    const extractor: ContentExtractor = { extract: async () => ({ text: 'x' }) };

    await expect(crawlPendingArticles({ repo, extractor })).rejects.toThrow('connection refused');
  });

  it('retries instead of succeeding when the write itself fails after a successful extraction', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1', fetch_attempts: 0 }));
    repo.markDoneError = 'connection reset';
    const extractor: ContentExtractor = { extract: async () => ({ text: 'nội dung' }) };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await crawlPendingArticles({ repo, extractor });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(repo.articles[0].content_fetch_status).toBe('pending');
    expect(repo.articles[0].fetch_attempts).toBe(1);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
