import { describe, it, expect } from 'vitest';
import { runDeepCrawlFacebook } from '../src/deep-crawl-facebook';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';
import type { FacebookPageScrapeClient, FacebookPost } from '../src/lib/apify-facebook-client';
import type { FacebookSeedPage } from '../src/lib/facebook-seed-pages';

function post(overrides: Partial<FacebookPost> = {}): FacebookPost {
  return {
    post_url: 'https://www.facebook.com/page/posts/1',
    text_content: 'hello',
    like_count: 1,
    comment_count: 1,
    share_count: 0,
    posted_at: '2026-08-23T00:00:00Z',
    ...overrides,
  };
}

class FakeFacebookPageScrapeClient implements FacebookPageScrapeClient {
  public calls: string[] = [];
  public postsByPage: Record<string, FacebookPost[]> = {};
  public errorForPage: Record<string, string> = {};

  async scrapePage(pageUrl: string): Promise<FacebookPost[]> {
    this.calls.push(pageUrl);
    if (this.errorForPage[pageUrl]) throw new Error(this.errorForPage[pageUrl]);
    return this.postsByPage[pageUrl] ?? [];
  }
}

const NOW = () => new Date('2026-08-23T09:00:00Z');

const TEST_SEED_PAGES: FacebookSeedPage[] = [
  { url: 'https://www.facebook.com/finance-page', category: 'tai_chinh' },
  { url: 'https://www.facebook.com/entertainment-page', category: 'giai_tri' },
];

describe('runDeepCrawlFacebook', () => {
  it('skips and returns early when facebook_page_data already has rows for today', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    await socialRepo.upsertPosts([
      {
        page_url: 'https://www.facebook.com/existing',
        category: 'tai_chinh',
        date: '2026-08-23',
        post_url: 'https://www.facebook.com/existing/posts/0',
      },
    ]);
    const client = new FakeFacebookPageScrapeClient();

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.skipped).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it('calls the client once per seed page', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.skipped).toBe(false);
    expect(result.pagesAttempted).toBe(2);
    expect(client.calls.sort()).toEqual([
      'https://www.facebook.com/entertainment-page',
      'https://www.facebook.com/finance-page',
    ]);
  });

  it('upserts posts returned by the client, tagging them with page_url/category/date', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();
    client.postsByPage['https://www.facebook.com/finance-page'] = [
      post({ post_url: 'https://www.facebook.com/finance-page/posts/1' }),
    ];

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
    expect(socialRepo.posts[0]).toMatchObject({
      page_url: 'https://www.facebook.com/finance-page',
      category: 'tai_chinh',
      date: '2026-08-23',
      post_url: 'https://www.facebook.com/finance-page/posts/1',
    });
  });

  it("isolates one page's client failure from the rest", async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();
    client.errorForPage['https://www.facebook.com/finance-page'] = 'actor failed';
    client.postsByPage['https://www.facebook.com/entertainment-page'] = [
      post({ post_url: 'https://www.facebook.com/entertainment-page/posts/2' }),
    ];

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.errors).toEqual([
      'crawl failed for "https://www.facebook.com/finance-page": actor failed',
    ]);
    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
  });

  it("isolates one page's upsert failure from the rest", async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    socialRepo.upsertError = 'db down';
    const client = new FakeFacebookPageScrapeClient();
    client.postsByPage['https://www.facebook.com/finance-page'] = [post()];

    const result = await runDeepCrawlFacebook({
      socialRepo,
      client,
      seedPages: [TEST_SEED_PAGES[0]],
      now: NOW,
    });

    expect(result.errors).toEqual([
      'upsert failed for "https://www.facebook.com/finance-page": db down',
    ]);
    expect(result.postsUpserted).toBe(0);
  });

  it('dedupes duplicate post_url from the same page before upserting', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();
    client.postsByPage['https://www.facebook.com/finance-page'] = [
      post({ post_url: 'https://www.facebook.com/finance-page/posts/1', text_content: 'first' }),
      post({ post_url: 'https://www.facebook.com/finance-page/posts/1', text_content: 'dup' }),
    ];

    const result = await runDeepCrawlFacebook({
      socialRepo,
      client,
      seedPages: [TEST_SEED_PAGES[0]],
      now: NOW,
    });

    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
  });

  it('defaults to the real FACEBOOK_SEED_PAGES list (6 pages) when seedPages is not provided', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();

    const result = await runDeepCrawlFacebook({ socialRepo, client, now: NOW });

    expect(result.pagesAttempted).toBe(6);
  });
});
