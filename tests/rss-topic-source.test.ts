import { describe, it, expect } from 'vitest';
import { RssTopicSource } from '../src/lib/rss-topic-source';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import { FakeTopicExtractor } from './fakes/fake-topic-extractor';
import { FakeTopicArticleDataRepository } from './fakes/fake-topic-article-data-repository';
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

  it('writes one topic_article_data link row per (article, extracted topic) pair', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Novaland chào bán cổ phiếu tỉ lệ 3:1'));
    const extractor = new FakeTopicExtractor();
    extractor.topicsByText['Novaland chào bán cổ phiếu tỉ lệ 3:1'] = ['novaland', 'chào bán cổ phiếu'];
    const articleLinkRepo = new FakeTopicArticleDataRepository();
    const source = new RssTopicSource(repo, extractor, articleLinkRepo, () => new Date('2026-10-04T10:00:00Z'));

    await source.fetchCandidates();

    expect(articleLinkRepo.links.map((l) => l.keyword).sort()).toEqual(['chào bán cổ phiếu', 'novaland']);
    expect(articleLinkRepo.links.every((l) => l.article_url === 'https://example.com/1')).toBe(true);
    expect(articleLinkRepo.links.every((l) => l.date === '2026-10-04')).toBe(true);
  });

  it('writes no link rows for an article that produced no topics', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Tiêu đề không rõ chủ đề'));
    const extractor = new FakeTopicExtractor(); // topicsByText has no entry -> []
    const articleLinkRepo = new FakeTopicArticleDataRepository();
    const source = new RssTopicSource(repo, extractor, articleLinkRepo);

    await source.fetchCandidates();

    expect(articleLinkRepo.links).toEqual([]);
  });

  it('dedupes a repeated keyword from the extractor into exactly one link row per article (would otherwise collide within one upsert batch)', async () => {
    const repo = new FakeArticleRepository();
    const title = 'Khách du lịch đổ về Phú Quốc dịp lễ';
    repo.articles.push(makeArticle('1', title));
    const extractor = new FakeTopicExtractor();
    // Simulates extractKeywords()'s regex fallback returning the same
    // keyword twice for one title (entity-phrase pass + bigram pass both
    // producing 'phú quốc').
    extractor.topicsByText[title] = ['phú quốc', 'phú quốc', 'quốc dịp'];
    const articleLinkRepo = new FakeTopicArticleDataRepository();
    const source = new RssTopicSource(repo, extractor, articleLinkRepo);

    await source.fetchCandidates();

    const matching = articleLinkRepo.links.filter(
      (l) => l.keyword === 'phú quốc' && l.article_url === 'https://example.com/1'
    );
    expect(matching.length).toBe(1);
  });

  it('still returns candidates when the link-write fails', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const articleLinkRepo = new FakeTopicArticleDataRepository();
    articleLinkRepo.upsertError = 'simulated failure';
    const source = new RssTopicSource(repo, undefined, articleLinkRepo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('still returns candidates when articleLinkRepo.upsertLinks throws', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const articleLinkRepo = {
      upsertLinks: async () => {
        throw new Error('network error');
      },
      getArticlesForDate: async () => [],
    };
    const source = new RssTopicSource(repo, undefined, articleLinkRepo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('works with no articleLinkRepo at all (optional dependency)', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });
});
