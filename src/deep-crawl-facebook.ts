import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { FacebookPageScrapeClient, FacebookPost } from './lib/apify-facebook-client';
import type { FacebookPageData, CandidateTopic, Category } from './types';
import { FACEBOOK_SEED_GROUPS, type FacebookSeedGroup } from './lib/facebook-seed-groups';
import { FACEBOOK_SEED_PAGES, type FacebookSeedPage } from './lib/facebook-seed-pages';
import { aggregateFacebookKeywords } from './lib/aggregate-facebook-keywords';
import { extractKeywords } from './lib/keyword-extractor';

export interface DeepCrawlFacebookDeps {
  socialRepo: FacebookPageDataRepository;
  candidateRepo: Pick<CandidateTopicRepository, 'upsertCandidates'>;
  groupsClient: FacebookPageScrapeClient;
  pagesClient: FacebookPageScrapeClient;
  seedGroups?: FacebookSeedGroup[];
  seedPages?: FacebookSeedPage[];
  now?: () => Date;
}

export interface DeepCrawlFacebookResult {
  skipped: boolean;
  seedsAttempted: number;
  candidatesUpserted: number;
  postsUpserted: number;
  errors: string[];
}

interface Seed {
  url: string;
  category: Category;
  client: FacebookPageScrapeClient;
}

export async function runDeepCrawlFacebook(deps: DeepCrawlFacebookDeps): Promise<DeepCrawlFacebookResult> {
  const now = deps.now ?? (() => new Date());
  const date = now().toISOString().slice(0, 10);
  const result: DeepCrawlFacebookResult = {
    skipped: false,
    seedsAttempted: 0,
    candidatesUpserted: 0,
    postsUpserted: 0,
    errors: [],
  };

  // Idempotency guard — same reasoning as deep-crawl.ts (2b): robust against
  // cron schedule changes and repeated workflow_dispatch runs on the same
  // day. See design spec §6.
  const alreadyRan = await deps.socialRepo.hasDataForDate(date);
  if (alreadyRan) {
    result.skipped = true;
    return result;
  }

  const seeds: Seed[] = [
    ...(deps.seedGroups ?? FACEBOOK_SEED_GROUPS).map((g) => ({ ...g, client: deps.groupsClient })),
    ...(deps.seedPages ?? FACEBOOK_SEED_PAGES).map((p) => ({ ...p, client: deps.pagesClient })),
  ];
  result.seedsAttempted = seeds.length;

  // Posts accumulated per category across every seed sharing that
  // category — same reasoning as deep-crawl.ts: a bigram appearing in
  // more than one seed's posts gets its engagement SUMMED, not
  // overwritten by whichever seed's upsert happens to run last.
  const postsByCategory = new Map<Category, FacebookPost[]>();

  for (const seed of seeds) {
    try {
      const posts = await seed.client.scrapePage(seed.url);
      // Per-seed visibility for the first live run — without this, a
      // group/page that returns 0 posts because of a real actor
      // failure/wrong field names is indistinguishable in the job's log
      // output from a seed that legitimately has no posts.
      console.log(`${seed.url}: ${posts.length} posts`);
      // Dedupe by post_url before upserting — same reason as deep-crawl.ts
      // (2b): every row for this seed shares page_url, so a duplicated
      // post_url would collide on the same unique conflict key within one
      // upsert statement and make Postgres reject the entire statement.
      // Drop posts with no text — nothing to extract keywords from.
      const dedupedPosts = [...new Map(posts.map((p) => [p.post_url, p])).values()].filter((p) => p.text_content);

      // One raw row per real post — see deep-crawl.ts's identical comment.
      const socialRows: Partial<FacebookPageData>[] = [];
      for (const p of dedupedPosts) {
        const keywords = extractKeywords(p.text_content);
        if (keywords.length === 0) continue;
        socialRows.push({ ...p, keyword: keywords[0], page_url: seed.url, category: seed.category, date });
      }
      const { error: socialError, count: socialCount } = await deps.socialRepo.upsertPosts(socialRows);
      if (socialError) {
        result.errors.push(`post upsert failed for "${seed.url}": ${socialError}`);
      } else {
        result.postsUpserted += socialCount;
      }

      const existing = postsByCategory.get(seed.category) ?? [];
      existing.push(...dedupedPosts);
      postsByCategory.set(seed.category, existing);
    } catch (err) {
      // One seed's failure must not abort the rest — same isolation
      // principle used throughout this codebase.
      result.errors.push(`crawl failed for "${seed.url}": ${(err as Error).message}`);
    }
  }

  for (const [category, posts] of postsByCategory) {
    const candidates = aggregateFacebookKeywords(posts, category);
    const candidateRows: Partial<CandidateTopic>[] = candidates.map((c) => ({
      source: 'facebook',
      keyword: c.keyword,
      date,
      metric_value: c.metric_value,
      growth_rate: null,
      category_hint: c.knownCategories ?? [category],
    }));
    const { error: candidateError, count: candidateCount } = await deps.candidateRepo.upsertCandidates(
      candidateRows
    );
    if (candidateError) {
      result.errors.push(`candidate upsert failed for "${category}": ${candidateError}`);
    } else {
      result.candidatesUpserted += candidateCount;
    }
  }

  return result;
}
