import { describe, it, expect } from 'vitest';
import { runDeepCrawl } from '../src/deep-crawl';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
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
});
