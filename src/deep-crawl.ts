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
  //
  // Note on actual semantics: this checks "has data been WRITTEN today", not
  // "has this job RUN today". If every topic in a run fails/times out and
  // zero rows get upserted, the next cron re-attempts from scratch and
  // re-spends Apify budget on the same topics. This is a deliberate
  // self-healing/re-spend tradeoff the design accepts — now bounded by a
  // fixed per-call timeout (see FETCH_TIMEOUT_MS in apify-threads-client.ts)
  // rather than left open-ended.
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
      // Dedupe by post_url before upserting: every row in this batch shares
      // (source, keyword), so a duplicated post_url from the Apify actor
      // would make two rows collide on the same unique(source,keyword,post_url)
      // conflict key within a single upsert statement — Postgres rejects the
      // ENTIRE statement ("ON CONFLICT DO UPDATE command cannot affect row a
      // second time"), losing all rows for this topic after the Apify charge
      // is already paid.
      const dedupedPosts = [...new Map(posts.map((p) => [p.post_url, p])).values()];
      // Spread ...post first so keyword/source/date (set by this job, not
      // the actor) can't be silently overwritten by a future ThreadsPost field.
      const rows: Partial<TopicSocialData>[] = dedupedPosts.map((post) => ({
        ...post,
        keyword,
        source: 'threads',
        date,
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
