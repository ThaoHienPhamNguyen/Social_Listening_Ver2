import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { ThreadsSearchClient, ThreadsPost } from './lib/apify-threads-client';
import type { TopicExtractor } from './lib/topic-extractor';
import type { TopicSocialData, CandidateTopic, Category } from './types';
import { THREADS_DISCOVERY_QUERIES } from './lib/threads-discovery-queries';
import { aggregateThreadsKeywords } from './lib/aggregate-threads-keywords';
import { extractKeywords } from './lib/keyword-extractor';

export interface DeepCrawlDeps {
  candidateRepo: Pick<CandidateTopicRepository, 'upsertCandidates'>;
  socialRepo: TopicSocialDataRepository;
  client: ThreadsSearchClient;
  extractor?: TopicExtractor;
  now?: () => Date;
}

export interface DeepCrawlResult {
  skipped: boolean;
  queriesRun: number;
  candidatesUpserted: number;
  postsUpserted: number;
  errors: string[];
}

// A Threads post can run to thousands of words (a full production-credits
// post was observed in production) — only the first MAX_EXTRACT_CHARS are
// sent to the LLM extractor, since a post's topic is established early and
// sending the whole thing would blow the token budget of a 20-post batch.
// The regex fallback (extractKeywords) always sees the full, untruncated
// text — it's cheap regardless of length.
const MAX_EXTRACT_CHARS = 500;

// Posts per LLM call — same precedent as rss-topic-source.ts's CHUNK_SIZE.
const CHUNK_SIZE = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Extracts topics for every post once, so both the raw-row tagging below
// and aggregateThreadsKeywords (called once per category, after every
// query's posts are collected) reuse the same result instead of paying for
// extraction twice. One chunk's LLM failure falls back to extractKeywords()
// for exactly that chunk's posts — same isolation principle as
// rss-topic-source.ts, never dropping a chunk's candidates entirely.
async function extractTopicsForPosts(
  posts: ThreadsPost[],
  extractor: TopicExtractor | undefined
): Promise<(ThreadsPost & { topics: string[] })[]> {
  const result: (ThreadsPost & { topics: string[] })[] = [];

  for (const batch of chunk(posts, CHUNK_SIZE)) {
    let topicsPerPost: string[][];

    if (extractor) {
      try {
        const texts = batch.map((p) => p.text_content.slice(0, MAX_EXTRACT_CHARS));
        topicsPerPost = await extractor.extractTopics(texts);
      } catch (err) {
        console.error(
          `Threads topic extraction failed for a chunk of ${batch.length} posts, falling back to regex: ${(err as Error).message}`
        );
        topicsPerPost = batch.map((p) => extractKeywords(p.text_content));
      }
    } else {
      topicsPerPost = batch.map((p) => extractKeywords(p.text_content));
    }

    batch.forEach((post, i) => {
      result.push({ ...post, topics: topicsPerPost[i] ?? [] });
    });
  }

  return result;
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
    // Posts across every query in this category, accumulated before a
    // single candidate upsert — a topic appearing in more than one query's
    // results (e.g. "hôm nay") gets its engagement SUMMED across queries
    // instead of a later query's upsert silently overwriting an earlier
    // one's metric_value (both queries share onConflict 'source,keyword,date',
    // so per-query upserts would race).
    const categoryPosts: (ThreadsPost & { topics: string[] })[] = [];

    for (const query of THREADS_DISCOVERY_QUERIES[category]) {
      result.queriesRun += 1;
      try {
        const posts = await deps.client.searchByKeyword(query);
        // Dedupe by post_url first — same reasoning as before: a duplicated
        // post_url from the actor would collide within one upsert batch.
        const dedupedPosts = [...new Map(posts.map((p) => [p.post_url, p])).values()].filter(
          (p) => p.text_content
        );

        const postsWithTopics = await extractTopicsForPosts(dedupedPosts, deps.extractor);

        // One raw row per real post — not per extracted topic — so
        // aggregate-engagement.ts's per-keyword grouping counts each
        // post's engagement exactly once. The post's first extracted topic
        // is its representative keyword for engagement rollup; ranking
        // (aggregateThreadsKeywords, below) still credits a post's
        // engagement to every topic it contains — a different question
        // ("what did this post talk about", not "which single bucket owns
        // this post's engagement for rollup purposes").
        const socialRows: Partial<TopicSocialData>[] = [];
        for (const p of postsWithTopics) {
          if (p.topics.length === 0) continue;
          const { topics, ...postFields } = p;
          socialRows.push({ ...postFields, keyword: topics[0], source: 'threads', date });
        }
        const { error: socialError, count: socialCount } = await deps.socialRepo.upsertPosts(socialRows);
        if (socialError) {
          result.errors.push(`post upsert failed for "${category}/${query}": ${socialError}`);
        } else {
          result.postsUpserted += socialCount;
        }

        categoryPosts.push(...postsWithTopics);
      } catch (err) {
        // One query's Apify failure must not abort the remaining queries —
        // same isolation principle used throughout this codebase.
        result.errors.push(`crawl failed for "${category}/${query}": ${(err as Error).message}`);
      }
    }

    // One candidate_topics upsert per category, over every query's posts
    // combined — see the comment on categoryPosts above.
    const candidates = aggregateThreadsKeywords(categoryPosts, category);
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
      result.errors.push(`candidate upsert failed for "${category}": ${candidateError}`);
    } else {
      result.candidatesUpserted += candidateCount;
    }
  }

  return result;
}
