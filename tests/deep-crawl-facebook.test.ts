import { describe, it, expect } from 'vitest';
import { runDeepCrawlFacebook } from '../src/deep-crawl-facebook';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';
import type { FacebookPageScrapeClient, FacebookPost } from '../src/lib/apify-facebook-client';
import type { FacebookSeedGroup } from '../src/lib/facebook-seed-groups';
import type { FacebookSeedPage } from '../src/lib/facebook-seed-pages';

function post(overrides: Partial<FacebookPost> = {}): FacebookPost {
  return {
    post_url: 'https://facebook.com/groups/x/posts/1',
    text_content: 'giá vàng hôm nay tăng mạnh',
    like_count: 1,
    comment_count: 1,
    share_count: 0,
    posted_at: '2026-09-10T00:00:00Z',
    ...overrides,
  };
}

class FakeClient implements FacebookPageScrapeClient {
  public calls: string[] = [];
  public postsByUrl: Record<string, FacebookPost[]> = {};
  public errorForUrl: Record<string, string> = {};

  async scrapePage(url: string): Promise<FacebookPost[]> {
    this.calls.push(url);
    if (this.errorForUrl[url]) throw new Error(this.errorForUrl[url]);
    return this.postsByUrl[url] ?? [];
  }
}

const SEED_GROUPS: FacebookSeedGroup[] = [{ url: 'https://facebook.com/groups/a', category: 'tai_chinh' }];
const SEED_PAGES: FacebookSeedPage[] = [{ url: 'https://facebook.com/vtv24', category: 'tai_chinh' }];
const NOW = () => new Date('2026-09-10T09:00:00Z');

describe('runDeepCrawlFacebook', () => {
  it('skips and returns early when facebook_page_data already has rows for today', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeFacebookPageDataRepository();
    await socialRepo.upsertPosts([
      { page_url: 'x', keyword: 'k', category: 'tai_chinh', date: '2026-09-10', post_url: 'p' },
    ]);
    const groupsClient = new FakeClient();
    const pagesClient = new FakeClient();

    const result = await runDeepCrawlFacebook({
      candidateRepo,
      socialRepo,
      groupsClient,
      pagesClient,
      seedGroups: SEED_GROUPS,
      seedPages: SEED_PAGES,
      now: NOW,
    });

    expect(result.skipped).toBe(true);
    expect(groupsClient.calls).toEqual([]);
    expect(pagesClient.calls).toEqual([]);
  });

  it('calls groupsClient for every seed group and pagesClient for every seed page', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeFacebookPageDataRepository();
    const groupsClient = new FakeClient();
    const pagesClient = new FakeClient();

    const result = await runDeepCrawlFacebook({
      candidateRepo,
      socialRepo,
      groupsClient,
      pagesClient,
      seedGroups: SEED_GROUPS,
      seedPages: SEED_PAGES,
      now: NOW,
    });

    expect(result.skipped).toBe(false);
    expect(result.seedsAttempted).toBe(2);
    expect(groupsClient.calls).toEqual(['https://facebook.com/groups/a']);
    expect(pagesClient.calls).toEqual(['https://facebook.com/vtv24']);
  });

  it('extracts keywords and upserts both candidate_topics and facebook_page_data, for both a group and a page', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeFacebookPageDataRepository();
    const groupsClient = new FakeClient();
    const pagesClient = new FakeClient();
    groupsClient.postsByUrl['https://facebook.com/groups/a'] = [
      post({ post_url: 'https://facebook.com/groups/a/posts/1', text_content: 'giá vàng hôm nay', like_count: 10 }),
    ];
    pagesClient.postsByUrl['https://facebook.com/vtv24'] = [
      post({ post_url: 'https://facebook.com/vtv24/posts/1', text_content: 'thời tiết hôm nay', like_count: 5 }),
    ];

    const result = await runDeepCrawlFacebook({
      candidateRepo,
      socialRepo,
      groupsClient,
      pagesClient,
      seedGroups: SEED_GROUPS,
      seedPages: SEED_PAGES,
      now: NOW,
    });

    expect(result.postsUpserted).toBeGreaterThan(0);
    expect(result.candidatesUpserted).toBeGreaterThan(0);
    const giaVang = candidateRepo.candidates.find((c) => c.keyword === 'giá vàng');
    expect(giaVang).toMatchObject({ source: 'facebook', category_hint: ['tai_chinh'], growth_rate: null });
    const thoiTiet = candidateRepo.candidates.find((c) => c.keyword === 'thời tiết');
    expect(thoiTiet).toMatchObject({ source: 'facebook', category_hint: ['tai_chinh'] });
  });

  it("isolates one seed's client failure from the rest", async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeFacebookPageDataRepository();
    const groupsClient = new FakeClient();
    const pagesClient = new FakeClient();
    groupsClient.errorForUrl['https://facebook.com/groups/a'] = 'not_available';
    pagesClient.postsByUrl['https://facebook.com/vtv24'] = [post({ post_url: 'p1', text_content: 'thời tiết hôm nay' })];

    const result = await runDeepCrawlFacebook({
      candidateRepo,
      socialRepo,
      groupsClient,
      pagesClient,
      seedGroups: SEED_GROUPS,
      seedPages: SEED_PAGES,
      now: NOW,
    });

    expect(result.errors).toEqual(['crawl failed for "https://facebook.com/groups/a": not_available']);
    expect(result.postsUpserted).toBeGreaterThan(0);
  });
});
