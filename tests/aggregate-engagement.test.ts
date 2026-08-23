import { describe, it, expect } from 'vitest';
import { runAggregateEngagement } from '../src/aggregate-engagement';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeThreadsEngagementDailyRepository } from './fakes/fake-threads-engagement-repository';
import { FakeFacebookEngagementDailyRepository } from './fakes/fake-facebook-engagement-repository';
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

const NOW = () => new Date('2026-08-23T09:00:00Z');

describe('runAggregateEngagement', () => {
  it('sums Threads engagement per keyword and joins category from candidate_topics', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    await threadsSocialRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'p1', like_count: 10, reply_count: 1, repost_count: 2, quote_count: 0, share_count: 3, view_count: 100 },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'p2', like_count: 5, reply_count: 0, repost_count: 1, quote_count: 1, share_count: 2, view_count: 50 },
    ]);
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(candidate({ keyword: 'bitcoin', date: '2026-08-23', category_hint: ['tai_chinh'] }));
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.threadsRowsUpserted).toBe(1);
    expect(threadsEngagementRepo.rows).toHaveLength(1);
    expect(threadsEngagementRepo.rows[0]).toMatchObject({
      date: '2026-08-23',
      keyword: 'bitcoin',
      category: 'tai_chinh',
      total_like_count: 15,
      total_reply_count: 1,
      total_repost_count: 3,
      total_quote_count: 1,
      total_share_count: 5,
      total_view_count: 150,
      post_count: 2,
    });
  });

  it('sets category to null when no matching candidate_topics row exists for that keyword/date', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    await threadsSocialRepo.upsertPosts([
      { keyword: 'orphan', source: 'threads', date: '2026-08-23', post_url: 'p1' },
    ]);
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(threadsEngagementRepo.rows[0].category).toBeNull();
  });

  it('sums Facebook engagement per category', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    await facebookSocialRepo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1', like_count: 4, comment_count: 1, share_count: 2 },
      { page_url: 'https://www.facebook.com/vneconomy.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p2', like_count: 6, comment_count: 2, share_count: 1 },
    ]);
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.facebookRowsUpserted).toBe(1);
    expect(facebookEngagementRepo.rows[0]).toMatchObject({
      date: '2026-08-23',
      category: 'tai_chinh',
      total_like_count: 10,
      total_comment_count: 3,
      total_share_count: 3,
      post_count: 2,
    });
  });

  it("isolates Threads aggregation failure from Facebook's", async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    await threadsSocialRepo.upsertPosts([{ keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'p1' }]);
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    await facebookSocialRepo.upsertPosts([{ page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' }]);
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    threadsEngagementRepo.upsertError = 'db down';
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.errors).toEqual(['threads aggregate upsert failed: db down']);
    expect(result.facebookRowsUpserted).toBe(1);
  });

  it('returns 0 rows and no errors when there is no social data for the date', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.errors).toEqual([]);
    expect(result.threadsRowsUpserted).toBe(0);
    expect(result.facebookRowsUpserted).toBe(0);
  });
});
