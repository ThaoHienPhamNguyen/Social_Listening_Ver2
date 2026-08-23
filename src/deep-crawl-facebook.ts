import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { FacebookPageScrapeClient } from './lib/apify-facebook-client';
import type { FacebookPageData } from './types';
import { FACEBOOK_SEED_PAGES, type FacebookSeedPage } from './lib/facebook-seed-pages';

export interface DeepCrawlFacebookDeps {
  socialRepo: FacebookPageDataRepository;
  client: FacebookPageScrapeClient;
  // Injectable so tests use a small controlled list instead of depending on
  // the real production seed list — defaults to FACEBOOK_SEED_PAGES.
  seedPages?: FacebookSeedPage[];
  now?: () => Date;
}

export interface DeepCrawlFacebookResult {
  skipped: boolean;
  pagesCrawled: number;
  postsUpserted: number;
  errors: string[];
}

export async function runDeepCrawlFacebook(deps: DeepCrawlFacebookDeps): Promise<DeepCrawlFacebookResult> {
  const now = deps.now ?? (() => new Date());
  const date = now().toISOString().slice(0, 10);
  const result: DeepCrawlFacebookResult = { skipped: false, pagesCrawled: 0, postsUpserted: 0, errors: [] };

  // Idempotency guard — same reasoning as deep-crawl.ts (2b): robust against
  // cron schedule changes and repeated workflow_dispatch runs on the same
  // day. See design spec §6.
  const alreadyRan = await deps.socialRepo.hasDataForDate(date);
  if (alreadyRan) {
    result.skipped = true;
    return result;
  }

  const seedPages = deps.seedPages ?? FACEBOOK_SEED_PAGES;
  result.pagesCrawled = seedPages.length;

  for (const page of seedPages) {
    try {
      const posts = await deps.client.scrapePage(page.url);
      // Dedupe by post_url before upserting — same reason as deep-crawl.ts
      // (2b): every row in this batch shares page_url, so a duplicated
      // post_url would collide on the same unique(page_url,post_url)
      // conflict key within one upsert statement and make Postgres reject
      // the entire statement.
      const dedupedPosts = [...new Map(posts.map((p) => [p.post_url, p])).values()];
      // Spread ...post first so page_url/category/date (set by this job,
      // not the actor) can't be silently overwritten by a future
      // FacebookPost field.
      const rows: Partial<FacebookPageData>[] = dedupedPosts.map((p) => ({
        ...p,
        page_url: page.url,
        category: page.category,
        date,
      }));
      const { error, count } = await deps.socialRepo.upsertPosts(rows);
      if (error) {
        result.errors.push(`upsert failed for "${page.url}": ${error}`);
      } else {
        result.postsUpserted += count;
      }
    } catch (err) {
      // One page's Apify failure must not abort the remaining pages — same
      // isolation principle used throughout this project.
      result.errors.push(`crawl failed for "${page.url}": ${(err as Error).message}`);
    }
  }

  return result;
}
