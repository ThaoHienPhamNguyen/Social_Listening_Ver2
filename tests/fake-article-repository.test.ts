import { describe, it, expect } from 'vitest';
import { FakeArticleRepository } from './fakes/fake-article-repository';

describe('FakeArticleRepository', () => {
  it('adds a new article on upsert', async () => {
    const repo = new FakeArticleRepository();
    const { error } = await repo.upsertArticle({
      url: 'https://example.com/a',
      title: 'A',
      published_at: '2026-08-20T00:00:00Z',
      source_id: 'src-1',
      categories: ['tai_chinh'],
      snippet: '',
      full_content: null,
      content_fetch_status: 'pending',
      fetch_attempts: 0,
    });
    expect(error).toBeNull();
    expect(repo.articles).toHaveLength(1);
  });

  it('does not add a duplicate article with the same url', async () => {
    const repo = new FakeArticleRepository();
    const article = {
      url: 'https://example.com/a',
      title: 'A',
      published_at: '2026-08-20T00:00:00Z',
      source_id: 'src-1',
      categories: ['tai_chinh'],
      snippet: '',
      full_content: null,
      content_fetch_status: 'pending' as const,
      fetch_attempts: 0,
    };
    await repo.upsertArticle(article);
    await repo.upsertArticle(article);
    expect(repo.articles).toHaveLength(1);
  });

  it('getPendingArticles only returns pending rows under the attempt cap', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(
      { id: '1', url: 'u1', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0 },
      { id: '2', url: 'u2', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 3 },
      { id: '3', url: 'u3', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'done', fetch_attempts: 1 }
    );
    const pending = await repo.getPendingArticles(10, 3);
    expect(pending.map((p) => p.id)).toEqual(['1']);
  });

  it('markDone sets full_content, status, and categories', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push({ id: '1', url: 'u1', title: 't', published_at: '', source_id: 's', categories: ['giai_tri'], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0 });
    await repo.markDone('1', 'full text here', 1, ['giai_tri', 'tai_chinh']);
    expect(repo.articles[0].content_fetch_status).toBe('done');
    expect(repo.articles[0].full_content).toBe('full text here');
    expect(repo.articles[0].fetch_attempts).toBe(1);
    expect(repo.articles[0].categories).toEqual(['giai_tri', 'tai_chinh']);
  });

  it('markRetryOrFailed keeps status pending under the cap, flips to failed at the cap', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push({ id: '1', url: 'u1', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 1 });
    await repo.markRetryOrFailed('1', 2, 3);
    expect(repo.articles[0].content_fetch_status).toBe('pending');

    await repo.markRetryOrFailed('1', 3, 3);
    expect(repo.articles[0].content_fetch_status).toBe('failed');
  });
});
