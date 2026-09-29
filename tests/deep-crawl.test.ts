import { describe, it, expect } from 'vitest';
import { runDeepCrawl } from '../src/deep-crawl';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import { FakeTopicExtractor } from './fakes/fake-topic-extractor';
import type { ThreadsSearchClient, ThreadsPost } from '../src/lib/apify-threads-client';

function post(overrides: Partial<ThreadsPost> = {}): ThreadsPost {
  return {
    post_url: 'https://threads.net/p/1',
    text_content: 'giá vàng hôm nay tăng mạnh',
    like_count: 1,
    reply_count: 1,
    repost_count: 0,
    quote_count: 0,
    share_count: 0,
    view_count: 100,
    posted_at: '2026-09-10T00:00:00Z',
    ...overrides,
  };
}

class FakeThreadsSearchClient implements ThreadsSearchClient {
  public calls: string[] = [];
  public postsByKeyword: Record<string, ThreadsPost[]> = {};
  public errorForKeyword: Record<string, string> = {};

  async searchByKeyword(keyword: string): Promise<ThreadsPost[]> {
    this.calls.push(keyword);
    if (this.errorForKeyword[keyword]) throw new Error(this.errorForKeyword[keyword]);
    return this.postsByKeyword[keyword] ?? [];
  }
}

const NOW = () => new Date('2026-09-10T09:00:00Z');

describe('runDeepCrawl', () => {
  it('skips and returns early when topic_social_data already has rows for today', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    await socialRepo.upsertPosts([
      { keyword: 'existing', source: 'threads', date: '2026-09-10', post_url: 'https://threads.net/p/0' },
    ]);
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it('calls the client once per (category, query) pair — 6 calls total', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(false);
    expect(result.queriesRun).toBe(6);
    expect(client.calls.sort()).toEqual(
      ['chứng khoán', 'du lịch', 'ngân hàng', 'phim chiếu rạp', 'showbiz', 'vé máy bay'].sort()
    );
  });

  it('extracts keywords from real post text and upserts both candidate_topics and topic_social_data', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['chứng khoán'] = [
      post({ post_url: 'https://threads.net/p/1', text_content: 'giá vàng hôm nay tăng mạnh', like_count: 10 }),
    ];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.postsUpserted).toBeGreaterThan(0);
    expect(result.candidatesUpserted).toBeGreaterThan(0);
    const giaVang = candidateRepo.candidates.find((c) => c.keyword === 'giá vàng');
    expect(giaVang).toMatchObject({ source: 'threads', category_hint: ['tai_chinh'], growth_rate: null });
    const socialRow = socialRepo.posts.find((p) => p.keyword === 'giá vàng');
    expect(socialRow).toMatchObject({ source: 'threads', post_url: 'https://threads.net/p/1' });
  });

  it('writes exactly ONE raw social row per real post, tagged with its first extracted bigram', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    // 'giá vàng hôm nay tăng mạnh' yields 5 bigrams (giá vàng, vàng hôm, hôm
    // nay, nay tăng, tăng mạnh) — old behavior wrote 5 duplicate rows for
    // this single post; the fix must write exactly 1.
    client.postsByKeyword['chứng khoán'] = [
      post({ post_url: 'https://threads.net/p/1', text_content: 'giá vàng hôm nay tăng mạnh', like_count: 10 }),
    ];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    const rowsForPost = socialRepo.posts.filter((p) => p.post_url === 'https://threads.net/p/1');
    expect(rowsForPost).toHaveLength(1);
    expect(rowsForPost[0].keyword).toBe('giá vàng');
    expect(result.postsUpserted).toBe(1);
  });

  it("sums a bigram's engagement across every query sharing a category instead of a later upsert overwriting an earlier one", async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    // Both queries belong to tai_chinh (see THREADS_DISCOVERY_QUERIES) and
    // both posts share the bigram "giá vàng" with different engagement.
    client.postsByKeyword['chứng khoán'] = [
      post({
        post_url: 'https://threads.net/p/1',
        text_content: 'giá vàng tăng mạnh',
        like_count: 10,
        reply_count: 0,
        repost_count: 0,
        quote_count: 0,
        share_count: 0,
      }),
    ];
    client.postsByKeyword['ngân hàng'] = [
      post({
        post_url: 'https://threads.net/p/2',
        text_content: 'giá vàng giảm nhẹ',
        like_count: 20,
        reply_count: 0,
        repost_count: 0,
        quote_count: 0,
        share_count: 0,
      }),
    ];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    const giaVang = candidateRepo.candidates.find((c) => c.keyword === 'giá vàng');
    expect(giaVang?.metric_value).toBe(30);
    // One candidate upsert per category (3 categories total), not per query
    // (6 queries) — a later query's upsert must not silently overwrite an
    // earlier one's metric_value for the same keyword.
    expect(candidateRepo.upsertCandidatesCallSizes.length).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it("isolates one query's client failure from the rest", async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.errorForKeyword['chứng khoán'] = 'actor failed';
    client.postsByKeyword['ngân hàng'] = [post({ post_url: 'https://threads.net/p/2', text_content: 'lãi suất ngân hàng' })];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors).toEqual(['crawl failed for "tai_chinh/chứng khoán": actor failed']);
    expect(result.postsUpserted).toBeGreaterThan(0);
  });

  it("isolates one query's social-post upsert failure from the rest", async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    socialRepo.upsertError = 'db down';
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['chứng khoán'] = [post()];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors.some((e) => e.includes('post upsert failed'))).toBe(true);
    expect(result.postsUpserted).toBe(0);
  });

  it('produces no candidates and no social rows for a query that returns no posts', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.candidatesUpserted).toBe(0);
    expect(result.postsUpserted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('uses the extractor topics instead of the regex fallback when the extractor succeeds', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['chứng khoán'] = [
      post({ post_url: 'https://threads.net/p/1', text_content: 'Novaland chào bán cổ phiếu tỉ lệ 3:1' }),
    ];
    const extractor = new FakeTopicExtractor();
    extractor.topicsByText['Novaland chào bán cổ phiếu tỉ lệ 3:1'] = ['novaland', 'chào bán cổ phiếu'];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, extractor, now: NOW });

    expect(result.errors).toEqual([]);
    const socialRow = socialRepo.posts.find((p) => p.post_url === 'https://threads.net/p/1');
    expect(socialRow?.keyword).toBe('novaland');
    expect(candidateRepo.candidates.map((c) => c.keyword)).toContain('chào bán cổ phiếu');
  });

  it('falls back to extractKeywords for a chunk when the extractor throws', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['chứng khoán'] = [
      post({ post_url: 'https://threads.net/p/1', text_content: 'giá vàng hôm nay tăng mạnh' }),
    ];
    const extractor = new FakeTopicExtractor();
    extractor.shouldThrow = true;

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, extractor, now: NOW });

    expect(result.errors).toEqual([]);
    const socialRow = socialRepo.posts.find((p) => p.post_url === 'https://threads.net/p/1');
    expect(socialRow?.keyword).toBe('giá vàng');
  });

  it('truncates post text before sending it to the extractor, but the regex fallback still sees the full text', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    const longText = 'giá vàng hôm nay ' + 'x'.repeat(600);
    client.postsByKeyword['chứng khoán'] = [post({ post_url: 'https://threads.net/p/1', text_content: longText })];
    const extractor = new FakeTopicExtractor();

    await runDeepCrawl({ candidateRepo, socialRepo, client, extractor, now: NOW });

    expect(extractor.calls).toHaveLength(1);
    expect(extractor.calls[0][0].length).toBeLessThanOrEqual(500);
    expect(extractor.calls[0][0]).toBe(longText.slice(0, 500));
  });

  it('only extracts topics once per post — the same call feeds both the social row and the category candidate aggregation', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['chứng khoán'] = [
      post({ post_url: 'https://threads.net/p/1', text_content: 'giá vàng hôm nay' }),
    ];
    const extractor = new FakeTopicExtractor();
    extractor.topicsByText['giá vàng hôm nay'] = ['giá vàng'];

    await runDeepCrawl({ candidateRepo, socialRepo, client, extractor, now: NOW });

    // 6 queries total (THREADS_DISCOVERY_QUERIES), only 1 returns a post —
    // exactly 1 extractor call, not 2 (once for the social row, once again
    // for aggregation).
    expect(extractor.calls).toHaveLength(1);
  });
});
