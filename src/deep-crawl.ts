import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { ThreadsSearchClient } from './lib/apify-threads-client';
import type { TopicSocialData, CandidateTopic, Category } from './types';
import { THREADS_DISCOVERY_QUERIES } from './lib/threads-discovery-queries';
import { aggregateThreadsKeywords } from './lib/aggregate-threads-keywords';
import { extractKeywords } from './lib/keyword-extractor';

export interface DeepCrawlDeps {
  candidateRepo: Pick<CandidateTopicRepository, 'upsertCandidates'>;
  socialRepo: TopicSocialDataRepository;
  client: ThreadsSearchClient;
  now?: () => Date;
}

export interface DeepCrawlResult {
  skipped: boolean;
  queriesRun: number;
  candidatesUpserted: number;
  postsUpserted: number;
  errors: string[];
}

export async function runDeepCrawl(deps: DeepCrawlDeps): Promise<DeepCrawlResult> {
  const now = deps.now ?? (() => new Date());
  const date = now().toISOString().slice(0, 10);
  const result: DeepCrawlResult = {
    skipped: false,
    queriesRun: 0,
    candidatesUpserted: 0,
    postsUpserted: 0,
    errors: [],
  };

  // Idempotency guard — same reasoning as before: robust against cron
  // schedule changes and repeated workflow_dispatch runs on the same day.
  const alreadyRan = await deps.socialRepo.hasDataForDate(date);
  if (alreadyRan) {
    result.skipped = true;
    return result;
  }

  const categories = Object.keys(THREADS_DISCOVERY_QUERIES) as Category[];
  for (const category of categories) {
    for (const query of THREADS_DISCOVERY_QUERIES[category]) {
      result.queriesRun += 1;
      try {
        const posts = await deps.client.searchByKeyword(query);
        // Dedupe by post_url first — same reasoning as before: a duplicated
        // post_url from the actor would collide within one upsert batch.
        const dedupedPosts = [...new Map(posts.map((p) => [p.post_url, p])).values()].filter(
          (p) => p.text_content
        );

        // Raw posts: one row per (extracted keyword, post) pair — a post
        // can yield 2-3 bigrams, all legitimate under the
        // unique(source,keyword,post_url) constraint.
        const socialRows: Partial<TopicSocialData>[] = [];
        for (const p of dedupedPosts) {
          for (const keyword of new Set(extractKeywords(p.text_content))) {
            socialRows.push({ ...p, keyword, source: 'threads', date });
          }
        }
        const { error: socialError, count: socialCount } = await deps.socialRepo.upsertPosts(socialRows);
        if (socialError) {
          result.errors.push(`post upsert failed for "${category}/${query}": ${socialError}`);
        } else {
          result.postsUpserted += socialCount;
        }

        // Candidate topics: aggregated engagement per keyword, category
        // known for certain from the query itself.
        const candidates = aggregateThreadsKeywords(dedupedPosts, category);
        const candidateRows: Partial<CandidateTopic>[] = candidates.map((c) => ({
          source: 'threads',
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
          result.errors.push(`candidate upsert failed for "${category}/${query}": ${candidateError}`);
        } else {
          result.candidatesUpserted += candidateCount;
        }
      } catch (err) {
        // One query's Apify failure must not abort the remaining queries —
        // same isolation principle used throughout this codebase.
        result.errors.push(`crawl failed for "${category}/${query}": ${(err as Error).message}`);
      }
    }
  }

  return result;
}
