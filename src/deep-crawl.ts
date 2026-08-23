import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { ThreadsSearchClient } from './lib/apify-threads-client';
import type { TopicSocialData } from './types';
import { selectDeepCrawlTopics } from './lib/select-deep-crawl-topics';

export interface DeepCrawlDeps {
  candidateRepo: Pick<CandidateTopicRepository, 'getTodayCandidates'>;
  socialRepo: TopicSocialDataRepository;
  client: ThreadsSearchClient;
  now?: () => Date;
}

export interface DeepCrawlResult {
  skipped: boolean;
  topicsSelected: number;
  postsUpserted: number;
  errors: string[];
}

export async function runDeepCrawl(deps: DeepCrawlDeps): Promise<DeepCrawlResult> {
  const now = deps.now ?? (() => new Date());
  const date = now().toISOString().slice(0, 10);
  const result: DeepCrawlResult = { skipped: false, topicsSelected: 0, postsUpserted: 0, errors: [] };

  // Idempotency guard instead of hardcoding "only run at the day's last
  // cron" — robust against cron schedule changes and repeated
  // workflow_dispatch runs, which would otherwise double-spend Apify budget
  // for the same day. See design spec §5.
  const alreadyRan = await deps.socialRepo.hasDataForDate(date);
  if (alreadyRan) {
    result.skipped = true;
    return result;
  }

  const candidates = await deps.candidateRepo.getTodayCandidates(date);
  const topics = selectDeepCrawlTopics(candidates);
  result.topicsSelected = topics.length;

  for (const keyword of topics) {
    try {
      const posts = await deps.client.searchByKeyword(keyword);
      const rows: Partial<TopicSocialData>[] = posts.map((post) => ({
        keyword,
        source: 'threads',
        date,
        ...post,
      }));
      const { error, count } = await deps.socialRepo.upsertPosts(rows);
      if (error) {
        result.errors.push(`upsert failed for "${keyword}": ${error}`);
      } else {
        result.postsUpserted += count;
      }
    } catch (err) {
      // One topic's Apify failure must not abort the remaining topics — same
      // isolation principle used throughout discovery-ingest.ts/ingest-rss.ts.
      result.errors.push(`crawl failed for "${keyword}": ${(err as Error).message}`);
    }
  }

  return result;
}
