import { describe, it, expect } from 'vitest';
import { runDeepCrawl } from '../src/deep-crawl';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import type { ThreadsSearchClient, ThreadsPost } from '../src/lib/apify-threads-client';
import type { CandidateTopic } from '../src/types';

function candidate(overrides: Partial<CandidateTopic>): CandidateTopic {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'google_trends',
    keyword: 'x',
    date: '2026-08-23',
    metric_value: 100,
    growth_rate: 1,
    category_hint: [],
    is_shortlisted: true,
    ...overrides,
  };
}

function post(overrides: Partial<ThreadsPost> = {}): ThreadsPost {
  return {
    post_url: 'https://threads.net/p/1',
    text_content: 'hello',
    like_count: 1,
    reply_count: 1,
    repost_count: 0,
    quote_count: 0,
    share_count: 0,
    view_count: 100,
    posted_at: '2026-08-23T00:00:00Z',
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

const NOW = () => new Date('2026-08-23T09:00:00Z');

describe('runDeepCrawl', () => {
  it('skips and returns early when topic_social_data already has rows for today', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    await socialRepo.upsertPosts([
      { keyword: 'existing', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/0' },
    ]);
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it('selects topics via selectDeepCrawlTopics and calls the client once per topic', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(
      candidate({ keyword: 'bitcoin', date: '2026-08-23', growth_rate: 10 }),
      candidate({ keyword: 'vang', date: '2026-08-23', growth_rate: 5 })
    );
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(false);
    expect(result.topicsSelected).toBe(2);
    expect(client.calls.sort()).toEqual(['bitcoin', 'vang']);
  });

  it('upserts posts returned by the client, tagging them with keyword/source/date', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(candidate({ keyword: 'bitcoin', date: '2026-08-23' }));
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['bitcoin'] = [post({ post_url: 'https://threads.net/p/1' })];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
    expect(socialRepo.posts[0]).toMatchObject({
      keyword: 'bitcoin',
      source: 'threads',
      date: '2026-08-23',
      post_url: 'https://threads.net/p/1',
    });
  });

  it('isolates one topic\'s client failure from the rest', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(
      candidate({ keyword: 'bitcoin', date: '2026-08-23', growth_rate: 10 }),
      candidate({ keyword: 'vang', date: '2026-08-23', growth_rate: 5 })
    );
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.errorForKeyword['bitcoin'] = 'actor failed';
    client.postsByKeyword['vang'] = [post({ post_url: 'https://threads.net/p/2' })];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors).toEqual(['crawl failed for "bitcoin": actor failed']);
    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
  });

  it('isolates one topic\'s upsert failure from the rest', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(candidate({ keyword: 'bitcoin', date: '2026-08-23' }));
    const socialRepo = new FakeTopicSocialDataRepository();
    socialRepo.upsertError = 'db down';
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['bitcoin'] = [post()];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors).toEqual(['upsert failed for "bitcoin": db down']);
    expect(result.postsUpserted).toBe(0);
  });

  it('returns 0 topics and makes no client calls when there are no candidates at all today', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.topicsSelected).toBe(0);
    expect(client.calls).toEqual([]);
  });

  it('returns 0 topics and makes no client calls when candidates exist but none are shortlisted', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(
      candidate({ keyword: 'bitcoin', date: '2026-08-23', growth_rate: 10, is_shortlisted: false }),
      candidate({ keyword: 'vang', date: '2026-08-23', growth_rate: 5, is_shortlisted: false })
    );
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.topicsSelected).toBe(0);
    expect(client.calls).toEqual([]);
  });

  it('calls the client at most 8 times when more than 8 candidates are shortlisted', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    for (let i = 0; i < 10; i++) {
      candidateRepo.candidates.push(
        candidate({ keyword: `topic-${i}`, date: '2026-08-23', growth_rate: 10 - i })
      );
    }
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.topicsSelected).toBeLessThanOrEqual(8);
    expect(client.calls.length).toBeLessThanOrEqual(8);
  });
});
