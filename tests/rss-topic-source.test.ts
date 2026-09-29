import { describe, it, expect } from 'vitest';
import { RssTopicSource } from '../src/lib/rss-topic-source';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import { FakeTopicExtractor } from './fakes/fake-topic-extractor';
import type { Article } from '../src/types';

function makeArticle(id: string, title: string, categories: string[] = []): Article {
  return {
    id,
    url: `https://example.com/${id}`,
    title,
    published_at: '',
    source_id: 's',
    categories,
    snippet: '',
    full_content: null,
    content_fetch_status: 'pending',
    fetch_attempts: 0,
    created_at: new Date().toISOString(),
  };
}

describe('RssTopicSource', () => {
  it('fetches recent titles from the repository and aggregates them into candidates', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(source.name).toBe('rss');
    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('requests only 1 day of lookback, so metric_value reflects that day only (not a multi-day rolling window)', async () => {
    let requestedDays: number | undefined;
    const repo = {
      getRecentTitles: async (days: number) => {
        requestedDays = days;
        return [];
      },
    };
    const source = new RssTopicSource(repo);

    await source.fetchCandidates();

    expect(requestedDays).toBe(1);
  });

  it('produces no candidates and never calls the extractor when there are no recent articles', async () => {
    const repo = new FakeArticleRepository();
    const extractor = new FakeTopicExtractor();
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates).toEqual([]);
    expect(extractor.calls).toEqual([]);
  });

  it('uses the extractor topics instead of the regex fallback when the extractor succeeds', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Novaland chào bán cổ phiếu tỉ lệ 3:1'));
    const extractor = new FakeTopicExtractor();
    extractor.topicsByText['Novaland chào bán cổ phiếu tỉ lệ 3:1'] = ['novaland', 'chào bán cổ phiếu'];
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates.map((c) => c.keyword).sort()).toEqual(['chào bán cổ phiếu', 'novaland']);
  });

  it('falls back to extractKeywords for a chunk when the extractor throws', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const extractor = new FakeTopicExtractor();
    extractor.shouldThrow = true;
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('falls back to extractKeywords for every title when no extractor is provided', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('treats a shorter-than-expected extractor response as empty topics for the missing titles, without crashing', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Tiêu đề một'));
    repo.articles.push(makeArticle('2', 'Tiêu đề hai'));
    const extractor = new FakeTopicExtractor();
    extractor.extractTopics = async () => [['tiêu đề một']]; // only 1 entry for 2 titles
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates.map((c) => c.keyword)).toEqual(['tiêu đề một']);
  });

  it('isolates a failing chunk from a succeeding one, and still calls the extractor once per chunk on an exact chunk-size boundary', async () => {
    const repo = new FakeArticleRepository();
    // 20 articles (exactly CHUNK_SIZE) whose chunk will fail, plus 5 more in a
    // second, succeeding chunk — pins both "no trailing empty chunk on an
    // exact boundary" and "one failing chunk doesn't block the next".
    for (let i = 0; i < 20; i++) {
      repo.articles.push(makeArticle(`a${i}`, `Tiêu đề chung số ${i}`));
    }
    for (let i = 0; i < 5; i++) {
      repo.articles.push(makeArticle(`b${i}`, `Bài viết riêng số ${i}`));
    }
    const extractor = new FakeTopicExtractor();
    let callCount = 0;
    extractor.extractTopics = async (titles: string[]) => {
      callCount += 1;
      if (callCount === 1) throw new Error('first chunk fails');
      return titles.map(() => ['chủ đề riêng']);
    };
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(callCount).toBe(2);
    expect(candidates.some((c) => c.keyword === 'chủ đề riêng')).toBe(true);
  });
});
