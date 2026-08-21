import { describe, it, expect } from 'vitest';
import { RssTopicSource } from '../src/lib/rss-topic-source';
import { FakeArticleRepository } from './fakes/fake-article-repository';

describe('RssTopicSource', () => {
  it('fetches recent titles from the repository and aggregates them into candidates', async () => {
    const repo = new FakeArticleRepository();
    const now = Date.now();
    repo.articles.push({
      id: '1', url: 'u1', title: 'Giá vàng tăng mạnh', published_at: '', source_id: 's',
      categories: [], snippet: '', full_content: null, content_fetch_status: 'pending',
      fetch_attempts: 0, created_at: new Date(now).toISOString(),
    });
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(source.name).toBe('rss');
    expect(candidates.some((c) => c.keyword === 'vàng')).toBe(true);
  });
});
