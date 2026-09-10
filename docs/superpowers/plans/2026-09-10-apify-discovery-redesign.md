# Apify Discovery Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Threads and Facebook into independent discovery sources (like Google Trends/YouTube/RSS) that self-extract trending keywords from real crawled content, instead of only deep-crawling keywords the free discovery layer already picked — and remove sentiment classification entirely, keeping engagement aggregation untouched.

**Architecture:** `deep-crawl.ts` (Threads) and `deep-crawl-facebook.ts` (Facebook) stop reading `candidate_topics.is_shortlisted`. Threads runs 6 broad category-level searches/day (3 categories × 2 queries); Facebook crawls 5 community groups + 1 exception page (VTV24) — all via `apify/facebook-groups-scraper` for groups and the existing `apify/facebook-posts-scraper` for VTV24. Both extract 2-word keyword phrases from real post text (reusing `extractKeywords`), sum real engagement per keyword as `metric_value`, and write `candidate_topics` rows directly (no LLM classification needed — category is already known from the seed). `rank-and-select.ts` is untouched — it already computes `growth_rate` generically per source. Sentiment classification (`classify-sentiment` job, `openai-sentiment-classifier.ts`, the `sentiment` columns) is deleted; `aggregate-engagement.ts` and its 2 daily-engagement tables are untouched. Dashboard: widen `CandidateTopic['source']`, remove every sentiment-only UI surface, keep every engagement-only one.

**Tech Stack:** TypeScript, Vitest, `@supabase/supabase-js`, native `fetch` (Apify REST), Next.js/React 19 (dashboard).

**Spec:** `docs/superpowers/specs/2026-09-04-apify-discovery-redesign.md`

## Global Constraints

- Threads: 3 categories × 2 broad queries/day = 6 Apify calls/day, `max_posts: 50`, `maxTotalChargeUsd: 0.5` per call (spec §4, §7) — actor/mode unchanged from `apify-threads-client.ts`.
- Facebook groups: actor `apify/facebook-groups-scraper`, `resultsLimit: 50`, `maxTotalChargeUsd: 0.1` per call (spec §5.2a). Seed list is exactly the 5 verified groups in spec §5.1 (2 tai_chinh, 1 giai_tri, 2 du_lich).
- Facebook page exception: exactly 1 entry, VTV24 (`https://www.facebook.com/tintucvtv24/`, category `tai_chinh`), via the existing `apify/facebook-posts-scraper` actor/client, `MAX_POSTS_PER_PAGE = 15` unchanged (spec §5.1b, §5.2b).
- Keyword extraction: reuse `src/lib/keyword-extractor.ts`'s `extractKeywords` verbatim (2-word bigrams) — do not write a new extractor.
- `candidate_topics.source` check constraint must allow exactly `('google_trends', 'youtube', 'rss', 'threads', 'facebook')` (spec §6).
- Every new/changed Threads or Facebook `candidate_topics` row gets `growth_rate: null` at write time — `rank-and-select.ts` computes it later from baseline, same as YouTube/RSS today. Never compute growth_rate in deep-crawl code.
- Sentiment is deleted, not deprecated: `run-classify-sentiment.ts`, `src/classify-sentiment.ts`, `src/lib/openai-sentiment-classifier.ts`, the `classify-sentiment` GitHub Actions job, the `sentiment` columns on `topic_social_data`/`facebook_page_data`, and every dashboard sentiment-only file/section (spec §2 point 5, §8) are all removed in this plan — not left in place "for later."
- `aggregate-engagement.ts`, `threads_engagement_daily`, `facebook_engagement_daily`, and every dashboard section reading them (Buzz Volume, Audience Scale, Share of Voice, Buzz Trend, `BuzzByPlatformSection`) are explicitly OUT of scope — do not modify them except where a type they import (`CandidateTopic['source']`) widens.

---

## File Structure

**New files (`src/`):**
- `src/lib/threads-discovery-queries.ts` — `THREADS_DISCOVERY_QUERIES` constant.
- `src/lib/aggregate-threads-keywords.ts` — extraction + engagement-summing for Threads posts.
- `src/lib/facebook-seed-groups.ts` — `FACEBOOK_SEED_GROUPS` constant.
- `src/lib/apify-facebook-groups-client.ts` — Apify client for `apify/facebook-groups-scraper`.
- `src/lib/aggregate-facebook-keywords.ts` — extraction + engagement-summing for Facebook posts (groups and the VTV24 page share this, since both produce the same `FacebookPost` shape).

**Deleted files:** `src/lib/select-deep-crawl-topics.ts` (+ test), `src/run-classify-sentiment.ts`, `src/classify-sentiment.ts`, `src/lib/openai-sentiment-classifier.ts` (+ `tests/classify-sentiment.test.ts`, `tests/fakes/fake-sentiment-classifier.ts`).

**Rewritten files:** `src/deep-crawl.ts`, `src/deep-crawl-facebook.ts`, `src/run-deep-crawl-facebook.ts`, `src/lib/facebook-seed-pages.ts` (6 pages → 1), `src/lib/facebook-page-data-repository.ts` (+ its Fake), `src/lib/topic-social-data-repository.ts` (+ its Fake), `.github/workflows/discovery-ingestion.yml`, `package.json` (scripts).

**Dashboard:** widen `dashboard/lib/types.ts`; delete `dashboard/lib/sentiment-by-category.ts`, `sentiment-trend.ts`, `threads-sentiment-reader.ts`, `facebook-sentiment-reader.ts`, `dashboard/components/SentimentByCategorySection.tsx`, `SentimentTrendChart.tsx`, `SentimentBar.tsx` (+ their tests/fakes); trim sentiment fields out of `topic-engagement.ts`, `facebook-summary.ts`, `hot-topic-format.ts`, `overview-metrics.ts`, `topic-detail.ts`; update every page/component that wired those in.

---

## Task 1: Widen source types + database migration

**Files:**
- Modify: `src/types.ts` (`DiscoverySourceName`, `TopicSocialData` — drop `sentiment`), `src/types.ts` (`FacebookPageData` — add `keyword`, drop `sentiment`)
- Create: `supabase/migrations/0007_apify_discovery_redesign.sql`
- Test: none (pure type + SQL, no runtime logic yet — covered by every later task's own tests failing to compile otherwise)

**Interfaces:**
- Produces: `DiscoverySourceName = 'google_trends' | 'youtube' | 'rss' | 'threads' | 'facebook'` (also widens `CandidateTopic['source']`, which is typed as `DiscoverySourceName`). `FacebookPageData.keyword: string`.

- [ ] **Step 1: Widen `DiscoverySourceName`, drop sentiment fields, add `keyword`**

In `src/types.ts`:

```typescript
export type DiscoverySourceName = 'google_trends' | 'youtube' | 'rss' | 'threads' | 'facebook';
```

Remove `sentiment?: SentimentLabel | null;` from `TopicSocialData` and from `FacebookPageData`. Add `keyword: string;` to `FacebookPageData`, right after `page_url: string;`:

```typescript
export interface FacebookPageData {
  id?: string;
  page_url: string; // the seed URL crawled — a group URL or (for VTV24) a Page URL
  keyword: string;   // self-extracted from text_content, see aggregate-facebook-keywords.ts
  category: Category;
  date: string;
  post_url: string;
  text_content: string;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  posted_at: string | null;
  fetched_at?: string;
}
```

Delete the now-unused `SentimentLabel` export only if nothing else in `src/` still imports it — grep first:

Run: `grep -rl "SentimentLabel" src/ --include=*.ts`
Expected: only `src/types.ts` itself (its own declaration) — if any other file matches, leave the type declared for now; Task 10 deletes the sentiment classifier files that are the real remaining consumers, and will re-run this grep to confirm zero references before removing the type.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/0007_apify_discovery_redesign.sql

-- Threads and Facebook become independent discovery sources — widen the
-- source check constraint accordingly (spec §6).
alter table candidate_topics drop constraint candidate_topics_source_check;
alter table candidate_topics add constraint candidate_topics_source_check
  check (source in ('google_trends', 'youtube', 'rss', 'threads', 'facebook'));

-- facebook_page_data now stores self-extracted keywords per post (same
-- shape topic_social_data already has) instead of only page/category — a
-- post can yield 2-3 keywords, so the same post_url can legitimately repeat
-- under different keyword values. Existing rows get keyword = null (no
-- extracted-keyword data exists for historical rows); every future write
-- always supplies it.
alter table facebook_page_data add column keyword text;
alter table facebook_page_data drop constraint facebook_page_data_page_url_post_url_key;
alter table facebook_page_data add constraint facebook_page_data_page_url_keyword_post_url_key
  unique (page_url, keyword, post_url);

-- Sentiment classification is discontinued (spec §2 point 5) — drop the
-- columns it wrote. Historical sentiment values are not migrated anywhere;
-- this is a deliberate deletion, not an archive.
alter table topic_social_data drop column sentiment;
alter table facebook_page_data drop column sentiment;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAILS — every file still constructing a `TopicSocialData`/`FacebookPageData` literal with `sentiment`, or a `FacebookPageData` literal missing `keyword`, now errors. This is expected; later tasks fix each caller. Record the list of failing files from this run's output — Tasks 2-11 must clear all of them.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts supabase/migrations/0007_apify_discovery_redesign.sql
git commit -m "feat: widen discovery source types, add facebook_page_data.keyword, drop sentiment columns"
```

---

## Task 2: Threads discovery queries + keyword aggregation

**Files:**
- Create: `src/lib/threads-discovery-queries.ts`
- Create: `src/lib/aggregate-threads-keywords.ts`
- Test: `tests/aggregate-threads-keywords.test.ts`

**Interfaces:**
- Consumes: `extractKeywords(text: string): string[]` from `src/lib/keyword-extractor.ts`; `capCandidates(candidates, limit)` from `src/lib/cap-candidates.ts`; `RawCandidate` and `Category` from `src/types.ts`; `ThreadsPost` from `src/lib/apify-threads-client.ts`.
- Produces: `THREADS_DISCOVERY_QUERIES: Record<Category, string[]>`. `aggregateThreadsKeywords(posts: ThreadsPost[], category: Category): RawCandidate[]` — consumed by Task 3's `deep-crawl.ts`.

- [ ] **Step 1: Write the queries constant**

```typescript
// src/lib/threads-discovery-queries.ts
import type { Category } from '../types';

// Broad category-level search terms Threads is searched with, instead of a
// specific pre-selected keyword — see design spec §4. Fixed list, sewable
// to edit later without any architecture change (same convention as
// FACEBOOK_SEED_GROUPS/FACEBOOK_SEED_PAGES).
export const THREADS_DISCOVERY_QUERIES: Record<Category, string[]> = {
  tai_chinh: ['chứng khoán', 'ngân hàng'],
  giai_tri: ['showbiz', 'phim chiếu rạp'],
  du_lich: ['du lịch', 'vé máy bay'],
};
```

- [ ] **Step 2: Write the failing test for `aggregateThreadsKeywords`**

```typescript
// tests/aggregate-threads-keywords.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateThreadsKeywords } from '../src/lib/aggregate-threads-keywords';
import type { ThreadsPost } from '../src/lib/apify-threads-client';

function post(overrides: Partial<ThreadsPost> = {}): ThreadsPost {
  return {
    post_url: 'https://threads.net/p/1',
    text_content: 'giá vàng hôm nay tăng mạnh',
    like_count: 1,
    reply_count: 1,
    repost_count: 0,
    quote_count: 0,
    share_count: 0,
    view_count: 100,
    posted_at: '2026-09-10T00:00:00Z',
    ...overrides,
  };
}

describe('aggregateThreadsKeywords', () => {
  it('sums like+reply+repost+quote+share (not view_count) per extracted bigram', () => {
    const posts = [
      post({
        text_content: 'giá vàng hôm nay',
        like_count: 10,
        reply_count: 2,
        repost_count: 1,
        quote_count: 1,
        share_count: 1,
        view_count: 9999,
      }),
    ];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    const giaVang = result.find((c) => c.keyword === 'giá vàng');
    expect(giaVang?.metric_value).toBe(15); // 10+2+1+1+1, view_count excluded
  });

  it('tags every candidate with the passed-in category as knownCategories, and growth_rate null', () => {
    const posts = [post({ text_content: 'giá vàng hôm nay' })];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    expect(result[0].knownCategories).toEqual(['tai_chinh']);
    expect(result[0].growth_rate).toBeNull();
  });

  it('treats null engagement fields as 0', () => {
    const posts = [
      post({
        text_content: 'giá vàng hôm nay',
        like_count: null,
        reply_count: null,
        repost_count: null,
        quote_count: null,
        share_count: null,
      }),
    ];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    expect(result.find((c) => c.keyword === 'giá vàng')?.metric_value).toBe(0);
  });

  it('skips posts with empty text_content', () => {
    const posts = [post({ text_content: '' })];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    expect(result).toEqual([]);
  });

  it('does not double-count a repeated bigram within the same post', () => {
    // "vàng hôm nay" would appear as a bigram once ("hôm nay"); this test
    // checks that a post whose text is short still yields a single row per
    // distinct bigram, not per occurrence.
    const posts = [post({ text_content: 'vàng vàng hôm nay', like_count: 5 })];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    const vangVang = result.find((c) => c.keyword === 'vàng vàng');
    expect(vangVang?.metric_value).toBe(5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/aggregate-threads-keywords.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/aggregate-threads-keywords'"

- [ ] **Step 4: Implement**

```typescript
// src/lib/aggregate-threads-keywords.ts
import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { RawCandidate, Category } from '../types';
import type { ThreadsPost } from './apify-threads-client';

// Same cap as aggregate-youtube-keywords.ts — only the top MAX_CANDIDATES
// survive into candidate_topics, bounding write cost without affecting the
// shortlist outcome.
const MAX_CANDIDATES = 200;

export function aggregateThreadsKeywords(posts: ThreadsPost[], category: Category): RawCandidate[] {
  const totals = new Map<string, number>();

  for (const post of posts) {
    if (!post.text_content) continue;
    const engagement =
      (post.like_count ?? 0) +
      (post.reply_count ?? 0) +
      (post.repost_count ?? 0) +
      (post.quote_count ?? 0) +
      (post.share_count ?? 0);
    // Dedupe bigrams within one post before summing — same reasoning as
    // aggregate-youtube-keywords.ts's `new Set(...)`: a post repeating a
    // phrase must not inflate its own engagement contribution.
    for (const keyword of new Set(extractKeywords(post.text_content))) {
      totals.set(keyword, (totals.get(keyword) ?? 0) + engagement);
    }
  }

  const candidates = Array.from(totals.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
    // Category is known for certain from the search query's own category —
    // no substring-matching/LLM-classification needed downstream.
    knownCategories: [category],
  }));

  return capCandidates(candidates, MAX_CANDIDATES);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/aggregate-threads-keywords.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/threads-discovery-queries.ts src/lib/aggregate-threads-keywords.ts tests/aggregate-threads-keywords.test.ts
git commit -m "feat: add Threads discovery queries + keyword aggregation"
```

---

## Task 3: Rewrite `deep-crawl.ts` (Threads) — broad search, no topic selection

**Files:**
- Modify: `src/deep-crawl.ts` (full rewrite)
- Delete: `src/lib/select-deep-crawl-topics.ts`, `tests/select-deep-crawl-topics.test.ts` (check exact test filename with `Glob` first — if it doesn't exist under this name, find and delete the actual one)
- Modify: `tests/deep-crawl.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `THREADS_DISCOVERY_QUERIES` (Task 2), `aggregateThreadsKeywords` (Task 2), `extractKeywords` (existing), `ThreadsSearchClient`/`ThreadsPost` (existing, unchanged), `TopicSocialDataRepository.upsertPosts`/`hasDataForDate` (existing, unchanged), `CandidateTopicRepository.upsertCandidates` (existing, unchanged signature).
- Produces: `runDeepCrawl(deps: DeepCrawlDeps): Promise<DeepCrawlResult>` where `DeepCrawlResult = { skipped: boolean; queriesRun: number; candidatesUpserted: number; postsUpserted: number; errors: string[] }` — `run-deep-crawl.ts`'s console.log format changes accordingly (Task 3 also updates it).

- [ ] **Step 1: Delete the old topic-selection module**

Run: `ls tests/*.test.ts | grep -i select-deep-crawl` to find the exact test file name, then:

```bash
git rm src/lib/select-deep-crawl-topics.ts tests/select-deep-crawl-topics.test.ts
```

- [ ] **Step 2: Rewrite the failing test file**

```typescript
// tests/deep-crawl.test.ts
import { describe, it, expect } from 'vitest';
import { runDeepCrawl } from '../src/deep-crawl';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import type { ThreadsSearchClient, ThreadsPost } from '../src/lib/apify-threads-client';

function post(overrides: Partial<ThreadsPost> = {}): ThreadsPost {
  return {
    post_url: 'https://threads.net/p/1',
    text_content: 'giá vàng hôm nay tăng mạnh',
    like_count: 1,
    reply_count: 1,
    repost_count: 0,
    quote_count: 0,
    share_count: 0,
    view_count: 100,
    posted_at: '2026-09-10T00:00:00Z',
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

const NOW = () => new Date('2026-09-10T09:00:00Z');

describe('runDeepCrawl', () => {
  it('skips and returns early when topic_social_data already has rows for today', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    await socialRepo.upsertPosts([
      { keyword: 'existing', source: 'threads', date: '2026-09-10', post_url: 'https://threads.net/p/0' },
    ]);
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it('calls the client once per (category, query) pair — 6 calls total', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(false);
    expect(result.queriesRun).toBe(6);
    expect(client.calls.sort()).toEqual(
      ['chứng khoán', 'du lịch', 'ngân hàng', 'phim chiếu rạp', 'showbiz', 'vé máy bay'].sort()
    );
  });

  it('extracts keywords from real post text and upserts both candidate_topics and topic_social_data', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['chứng khoán'] = [
      post({ post_url: 'https://threads.net/p/1', text_content: 'giá vàng hôm nay tăng mạnh', like_count: 10 }),
    ];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.postsUpserted).toBeGreaterThan(0);
    expect(result.candidatesUpserted).toBeGreaterThan(0);
    const giaVang = candidateRepo.candidates.find((c) => c.keyword === 'giá vàng');
    expect(giaVang).toMatchObject({ source: 'threads', category_hint: ['tai_chinh'], growth_rate: null });
    const socialRow = socialRepo.posts.find((p) => p.keyword === 'giá vàng');
    expect(socialRow).toMatchObject({ source: 'threads', post_url: 'https://threads.net/p/1' });
  });

  it("isolates one query's client failure from the rest", async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.errorForKeyword['chứng khoán'] = 'actor failed';
    client.postsByKeyword['ngân hàng'] = [post({ post_url: 'https://threads.net/p/2', text_content: 'lãi suất ngân hàng' })];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors).toEqual(['crawl failed for "tai_chinh/chứng khoán": actor failed']);
    expect(result.postsUpserted).toBeGreaterThan(0);
  });

  it("isolates one query's social-post upsert failure from the rest", async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    socialRepo.upsertError = 'db down';
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['chứng khoán'] = [post()];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors.some((e) => e.includes('post upsert failed'))).toBe(true);
    expect(result.postsUpserted).toBe(0);
  });

  it('produces no candidates and no social rows for a query that returns no posts', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.candidatesUpserted).toBe(0);
    expect(result.postsUpserted).toBe(0);
    expect(result.errors).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/deep-crawl.test.ts`
Expected: FAIL — `result.queriesRun` is `undefined` (old `DeepCrawlResult` shape), old code still calls `selectDeepCrawlTopics` which no longer exists.

- [ ] **Step 4: Implement**

```typescript
// src/deep-crawl.ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/deep-crawl.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Update `run-deep-crawl.ts`'s log line**

In `src/run-deep-crawl.ts`, replace:

```typescript
  console.log(`topicsSelected=${result.topicsSelected} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`);
```

with:

```typescript
  console.log(
    `queriesRun=${result.queriesRun} candidatesUpserted=${result.candidatesUpserted} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`
  );
```

- [ ] **Step 7: Commit**

```bash
git add src/deep-crawl.ts src/run-deep-crawl.ts tests/deep-crawl.test.ts
git commit -m "feat: rewrite Threads deep-crawl as broad category search + keyword extraction"
```

---

## Task 4: Facebook seed groups + groups client

**Files:**
- Create: `src/lib/facebook-seed-groups.ts`
- Create: `src/lib/apify-facebook-groups-client.ts`
- Test: none — matches the existing convention that Apify HTTP clients (`apify-threads-client.ts`, `apify-facebook-client.ts`) are I/O wrappers, not unit-tested directly (their behavior is exercised through `deep-crawl*.ts`'s tests via fakes).

**Interfaces:**
- Produces: `FACEBOOK_SEED_GROUPS: FacebookSeedGroup[]` where `FacebookSeedGroup = { url: string; category: Category }`. `ApifyFacebookGroupsScrapeClient implements FacebookPageScrapeClient` (the SAME interface `apify-facebook-client.ts` already exports — both group and page scraping return the identical `FacebookPost` shape, verified live in spec §5.2a/§5.2b, so no new interface is needed).

- [ ] **Step 1: Write the seed groups constant**

```typescript
// src/lib/facebook-seed-groups.ts
import type { Category } from '../types';

export interface FacebookSeedGroup {
  url: string;
  category: Category;
}

// Community discussion groups, verified live + on-topic via real Apify
// calls during this feature's spec work (2026-09-04) — see design spec §5.1.
// giai_tri has only 1 verified group (the 2nd candidate tested, "Bí Mật
// Showbiz", returned not_available — locked, a known real-world failure
// mode for large VN groups, not a bug). Add a 2nd giai_tri group here when
// one is found; no architecture change needed (spec §9).
export const FACEBOOK_SEED_GROUPS: FacebookSeedGroup[] = [
  { url: 'https://www.facebook.com/groups/1978945002151603/', category: 'tai_chinh' }, // Cộng Đồng Chứng Khoán Việt Nam
  { url: 'https://www.facebook.com/groups/vnsic89/', category: 'tai_chinh' },           // VNSIC - Cộng Đồng Đầu Tư Chứng Khoán
  { url: 'https://www.facebook.com/groups/honghotshowbiz/', category: 'giai_tri' },     // Hóng hớt showbiz - 8 chuyện thiên hạ
  { url: 'https://www.facebook.com/groups/phuotluon/', category: 'du_lich' },           // Phượt Luôn
  { url: 'https://www.facebook.com/groups/YAN.VietNamOi/', category: 'du_lich' },       // Việt Nam Ơi (group)
];
```

- [ ] **Step 2: Write the groups client**

```typescript
// src/lib/apify-facebook-groups-client.ts
import type { FacebookPageScrapeClient, FacebookPost } from './apify-facebook-client';

const FETCH_TIMEOUT_MS = 300000; // matches apify-facebook-client.ts / apify-threads-client.ts
const RESULTS_LIMIT = 50;
const MAX_TOTAL_CHARGE_USD = 0.1;
const ACTOR_ID = 'apify~facebook-groups-scraper';

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Real adapter over Apify's run-sync-get-dataset-items endpoint, same
// pattern as apify-threads-client.ts / apify-facebook-client.ts. Field
// mapping verified live against real groups 2026-09-04 (design spec §5.2a):
// item.url / item.text / item.likesCount / item.commentsCount /
// item.sharesCount / item.time. Some items come back as
// { error: "not_available", ... } instead of a real post (a locked/removed
// group, or a removed post) — filtered out by the `typeof item.url ===
// 'string'` check below, same pattern apify-facebook-client.ts already uses.
export class ApifyFacebookGroupsScrapeClient implements FacebookPageScrapeClient {
  constructor(private apiToken: string) {}

  async scrapePage(groupUrl: string): Promise<FacebookPost[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${this.apiToken}&maxTotalChargeUsd=${MAX_TOTAL_CHARGE_USD}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          startUrls: [{ url: groupUrl }],
          resultsLimit: RESULTS_LIMIT,
          maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD,
        }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Apify request failed: ${response.status} ${bodyText.slice(0, 200)}`);
      }
      const items = (await response.json()) as Array<Record<string, unknown>>;
      return items
        .filter((item) => typeof item.url === 'string')
        .map((item) => ({
          post_url: item.url as string,
          text_content: toStringOrDefault(item.text, ''),
          like_count: toNumberOrNull(item.likesCount),
          comment_count: toNumberOrNull(item.commentsCount),
          share_count: toNumberOrNull(item.sharesCount),
          posted_at: toStringOrNull(item.time),
        }));
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors from these 2 files (they don't touch any existing broken caller yet).

- [ ] **Step 4: Commit**

```bash
git add src/lib/facebook-seed-groups.ts src/lib/apify-facebook-groups-client.ts
git commit -m "feat: add Facebook seed groups + apify/facebook-groups-scraper client"
```

---

## Task 5: Replace Facebook seed pages (6 brand pages → VTV24 only)

**Files:**
- Modify: `src/lib/facebook-seed-pages.ts` (full rewrite)
- Modify: `src/lib/apify-facebook-client.ts` (comment only — no code change)
- Modify: `tests/facebook-seed-pages.test.ts` (existing file, asserts the old "6 pages, 2/category" shape — must be updated or it fails against the new 1-page list)

**Interfaces:**
- Produces: `FACEBOOK_SEED_PAGES: FacebookSeedPage[]` — same type as before, now 1 entry.

- [ ] **Step 1: Rewrite the seed pages file**

```typescript
// src/lib/facebook-seed-pages.ts
import type { Category } from '../types';

export interface FacebookSeedPage {
  url: string;
  category: Category;
}

// Deliberate exception to the group-based model in facebook-seed-groups.ts
// — VTV24 is a Page, not a community group, kept at the user's explicit
// request for its reach (4.7M likes) despite being general/mixed news, not
// tai_chinh-specific content (only 1/5 sampled posts was finance-related
// when verified live 2026-09-04). Keywords extracted from it will legitimately
// include non-finance topics — not a bug, see design spec §5.1b.
export const FACEBOOK_SEED_PAGES: FacebookSeedPage[] = [
  { url: 'https://www.facebook.com/tintucvtv24/', category: 'tai_chinh' }, // Trung tâm Tin tức VTV24
];
```

- [ ] **Step 2: Update the "unverified" comment in `apify-facebook-client.ts`**

In `src/lib/apify-facebook-client.ts`, the comment block above the `.filter/.map` (currently reading "best-effort guesses... unverified against a real Apify response") is now stale — field names were verified live against VTV24 on 2026-09-04 (design spec §5.2b). Replace that comment block with:

```typescript
      // Field names below (url/text/likes/comments/shares/time) verified
      // live against a real apify/facebook-posts-scraper response
      // (VTV24, 2026-09-04 — design spec §5.2b). `comments` is absent
      // (not just 0) on "reel"/video-type items — toNumberOrNull already
      // handles that correctly by returning null for undefined input.
```

- [ ] **Step 3: Update the existing seed-list test**

`tests/facebook-seed-pages.test.ts` currently asserts "exactly 6 pages, 2 per category" — that assertion is now wrong by design. Replace its content:

```typescript
// tests/facebook-seed-pages.test.ts
import { describe, it, expect } from 'vitest';
import { FACEBOOK_SEED_PAGES } from '../src/lib/facebook-seed-pages';

describe('FACEBOOK_SEED_PAGES', () => {
  it('has exactly 1 page (the VTV24 exception), category tai_chinh', () => {
    expect(FACEBOOK_SEED_PAGES).toHaveLength(1);
    expect(FACEBOOK_SEED_PAGES[0]).toMatchObject({ category: 'tai_chinh' });
  });

  it('has no duplicate page URLs', () => {
    const urls = FACEBOOK_SEED_PAGES.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every URL is a facebook.com URL', () => {
    for (const page of FACEBOOK_SEED_PAGES) {
      expect(page.url).toMatch(/^https:\/\/www\.facebook\.com\//);
    }
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run tests/facebook-seed-pages.test.ts`
Expected: both pass — the exported shape (`FacebookSeedPage`, `FACEBOOK_SEED_PAGES`) is unchanged, only its content shrank.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook-seed-pages.ts src/lib/apify-facebook-client.ts tests/facebook-seed-pages.test.ts
git commit -m "feat: replace 6 Facebook brand pages with VTV24-only exception seed list"
```

---

## Task 6: Facebook keyword aggregation

**Files:**
- Create: `src/lib/aggregate-facebook-keywords.ts`
- Test: `tests/aggregate-facebook-keywords.test.ts`

**Interfaces:**
- Consumes: `extractKeywords`, `capCandidates`, `RawCandidate`/`Category` from `src/types.ts`, `FacebookPost` from `src/lib/apify-facebook-client.ts`.
- Produces: `aggregateFacebookKeywords(posts: FacebookPost[], category: Category): RawCandidate[]` — consumed by Task 7's `deep-crawl-facebook.ts`. Shared by both the group seeds and the VTV24 page seed, since both produce `FacebookPost[]`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/aggregate-facebook-keywords.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateFacebookKeywords } from '../src/lib/aggregate-facebook-keywords';
import type { FacebookPost } from '../src/lib/apify-facebook-client';

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

describe('aggregateFacebookKeywords', () => {
  it('sums like+comment+share per extracted bigram', () => {
    const posts = [post({ text_content: 'giá vàng hôm nay', like_count: 10, comment_count: 3, share_count: 2 })];
    const result = aggregateFacebookKeywords(posts, 'tai_chinh');
    expect(result.find((c) => c.keyword === 'giá vàng')?.metric_value).toBe(15);
  });

  it('tags every candidate with the passed-in category, growth_rate null', () => {
    const result = aggregateFacebookKeywords([post({ text_content: 'giá vàng hôm nay' })], 'tai_chinh');
    expect(result[0].knownCategories).toEqual(['tai_chinh']);
    expect(result[0].growth_rate).toBeNull();
  });

  it('treats null engagement fields as 0', () => {
    const posts = [post({ text_content: 'giá vàng hôm nay', like_count: null, comment_count: null, share_count: null })];
    const result = aggregateFacebookKeywords(posts, 'tai_chinh');
    expect(result.find((c) => c.keyword === 'giá vàng')?.metric_value).toBe(0);
  });

  it('skips posts with empty text_content', () => {
    const result = aggregateFacebookKeywords([post({ text_content: '' })], 'tai_chinh');
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aggregate-facebook-keywords.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/aggregate-facebook-keywords'"

- [ ] **Step 3: Implement**

```typescript
// src/lib/aggregate-facebook-keywords.ts
import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { RawCandidate, Category } from '../types';
import type { FacebookPost } from './apify-facebook-client';

const MAX_CANDIDATES = 200; // same cap as aggregate-youtube-keywords.ts / aggregate-threads-keywords.ts

// Shared by both FACEBOOK_SEED_GROUPS and FACEBOOK_SEED_PAGES (VTV24) —
// both produce the same FacebookPost shape, so one aggregation function
// covers both. See design spec §5.3.
export function aggregateFacebookKeywords(posts: FacebookPost[], category: Category): RawCandidate[] {
  const totals = new Map<string, number>();

  for (const post of posts) {
    if (!post.text_content) continue;
    const engagement = (post.like_count ?? 0) + (post.comment_count ?? 0) + (post.share_count ?? 0);
    for (const keyword of new Set(extractKeywords(post.text_content))) {
      totals.set(keyword, (totals.get(keyword) ?? 0) + engagement);
    }
  }

  const candidates = Array.from(totals.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
    knownCategories: [category],
  }));

  return capCandidates(candidates, MAX_CANDIDATES);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aggregate-facebook-keywords.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/aggregate-facebook-keywords.ts tests/aggregate-facebook-keywords.test.ts
git commit -m "feat: add Facebook keyword aggregation (shared by groups and VTV24 page)"
```

---

## Task 7: `facebook-page-data-repository.ts` — add keyword, drop sentiment

**Files:**
- Modify: `src/lib/facebook-page-data-repository.ts`
- Modify: `tests/fakes/fake-facebook-page-data-repository.ts`
- Test: `tests/fake-facebook-page-data-repository.test.ts` (already exists per repo grep — update it in place; do not create a duplicate)

**Interfaces:**
- Produces: `FacebookPageDataRepository` without `getUnclassifiedPosts`/`updateSentiment`; `upsertPosts` now conflicts on `page_url,keyword,post_url`.

- [ ] **Step 1: Rewrite the repository**

```typescript
// src/lib/facebook-page-data-repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookPageData } from '../types';

export interface FacebookPageDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<FacebookPageData>[]): Promise<{ error: string | null; count: number }>;
  getPostsForDate(date: string): Promise<FacebookPageData[]>;
}

export class SupabaseFacebookPageDataRepository implements FacebookPageDataRepository {
  constructor(private client: SupabaseClient) {}

  async hasDataForDate(date: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('facebook_page_data')
      .select('id', { count: 'exact', head: true })
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async upsertPosts(rows: Partial<FacebookPageData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('facebook_page_data')
      .upsert(rows, { onConflict: 'page_url,keyword,post_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }

  async getPostsForDate(date: string) {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('*')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as FacebookPageData[];
  }
}
```

- [ ] **Step 2: Rewrite the fake**

```typescript
// tests/fakes/fake-facebook-page-data-repository.ts
import type { FacebookPageDataRepository } from '../../src/lib/facebook-page-data-repository';
import type { FacebookPageData } from '../../src/types';

export class FakeFacebookPageDataRepository implements FacebookPageDataRepository {
  public posts: FacebookPageData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl-facebook's
  // batch error handling without a real database.
  public upsertError: string | null = null;

  async hasDataForDate(date: string): Promise<boolean> {
    return this.posts.some((p) => p.date === date);
  }

  async upsertPosts(rows: Partial<FacebookPageData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.posts.push({
        id: row.id ?? crypto.randomUUID(),
        page_url: row.page_url!,
        keyword: row.keyword!,
        category: row.category!,
        date: row.date!,
        post_url: row.post_url!,
        text_content: row.text_content ?? '',
        like_count: row.like_count ?? null,
        comment_count: row.comment_count ?? null,
        share_count: row.share_count ?? null,
        posted_at: row.posted_at ?? null,
      });
    }
    return { error: null, count: rows.length };
  }

  async getPostsForDate(date: string) {
    return this.posts.filter((p) => p.date === date);
  }
}
```

- [ ] **Step 3: Fix the fake's own test**

Run: `npx vitest run tests/fake-facebook-page-data-repository.test.ts`
Expected: FAIL if it asserts on `getUnclassifiedPosts`/`updateSentiment` — open the file and remove any `describe`/`it` blocks exercising those two methods (they no longer exist on the interface); keep the `upsertPosts`/`hasDataForDate`/`getPostsForDate` coverage, adding `keyword` to every constructed row so the fake's non-null-assertion (`row.keyword!`) doesn't throw.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fake-facebook-page-data-repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook-page-data-repository.ts tests/fakes/fake-facebook-page-data-repository.ts tests/fake-facebook-page-data-repository.test.ts
git commit -m "feat: add keyword to facebook_page_data upsert, drop sentiment methods"
```

---

## Task 8: Rewrite `deep-crawl-facebook.ts` — groups + VTV24 page, keyword extraction

**Files:**
- Modify: `src/deep-crawl-facebook.ts` (full rewrite)
- Modify: `src/run-deep-crawl-facebook.ts`
- Modify: `tests/deep-crawl-facebook.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `FACEBOOK_SEED_GROUPS` (Task 4), `FACEBOOK_SEED_PAGES` (Task 5), `aggregateFacebookKeywords` (Task 6), `extractKeywords`, `FacebookPageScrapeClient`/`FacebookPost` (existing, unchanged interface — both the groups client from Task 4 and the existing pages client implement it), `FacebookPageDataRepository` (Task 7), `CandidateTopicRepository.upsertCandidates` (existing).
- Produces: `runDeepCrawlFacebook(deps): Promise<DeepCrawlFacebookResult>` where `DeepCrawlFacebookResult = { skipped: boolean; seedsAttempted: number; candidatesUpserted: number; postsUpserted: number; errors: string[] }`.

- [ ] **Step 1: Rewrite the failing test file**

```typescript
// tests/deep-crawl-facebook.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/deep-crawl-facebook.test.ts`
Expected: FAIL — `runDeepCrawlFacebook` still expects the old `{ socialRepo, client, seedPages }` deps shape.

- [ ] **Step 3: Implement**

```typescript
// src/deep-crawl-facebook.ts
import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { FacebookPageScrapeClient } from './lib/apify-facebook-client';
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

  for (const seed of seeds) {
    try {
      const posts = await seed.client.scrapePage(seed.url);
      console.log(`${seed.url}: ${posts.length} posts`);
      const dedupedPosts = [...new Map(posts.map((p) => [p.post_url, p])).values()].filter((p) => p.text_content);

      const socialRows: Partial<FacebookPageData>[] = [];
      for (const p of dedupedPosts) {
        for (const keyword of new Set(extractKeywords(p.text_content))) {
          socialRows.push({ ...p, keyword, page_url: seed.url, category: seed.category, date });
        }
      }
      const { error: socialError, count: socialCount } = await deps.socialRepo.upsertPosts(socialRows);
      if (socialError) {
        result.errors.push(`post upsert failed for "${seed.url}": ${socialError}`);
      } else {
        result.postsUpserted += socialCount;
      }

      const candidates = aggregateFacebookKeywords(dedupedPosts, seed.category);
      const candidateRows: Partial<CandidateTopic>[] = candidates.map((c) => ({
        source: 'facebook',
        keyword: c.keyword,
        date,
        metric_value: c.metric_value,
        growth_rate: null,
        category_hint: c.knownCategories ?? [seed.category],
      }));
      const { error: candidateError, count: candidateCount } = await deps.candidateRepo.upsertCandidates(
        candidateRows
      );
      if (candidateError) {
        result.errors.push(`candidate upsert failed for "${seed.url}": ${candidateError}`);
      } else {
        result.candidatesUpserted += candidateCount;
      }
    } catch (err) {
      // One seed's failure must not abort the rest — same isolation
      // principle used throughout this codebase.
      result.errors.push(`crawl failed for "${seed.url}": ${(err as Error).message}`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/deep-crawl-facebook.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Update the entrypoint to wire both clients**

```typescript
// src/run-deep-crawl-facebook.ts
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { ApifyFacebookPageScrapeClient } from './lib/apify-facebook-client';
import { ApifyFacebookGroupsScrapeClient } from './lib/apify-facebook-groups-client';
import { runDeepCrawlFacebook } from './deep-crawl-facebook';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const socialRepo = new SupabaseFacebookPageDataRepository(client);
  const candidateRepo = new SupabaseCandidateTopicRepository(client);
  const apifyToken = getRequiredEnv('APIFY_TOKEN');
  const groupsClient = new ApifyFacebookGroupsScrapeClient(apifyToken);
  const pagesClient = new ApifyFacebookPageScrapeClient(apifyToken);

  const result = await runDeepCrawlFacebook({ socialRepo, candidateRepo, groupsClient, pagesClient });

  if (result.skipped) {
    console.log('Facebook deep-crawl already ran today — skipped.');
    return;
  }

  console.log(
    `seedsAttempted=${result.seedsAttempted} candidatesUpserted=${result.candidatesUpserted} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`
  );
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Commit**

```bash
git add src/deep-crawl-facebook.ts src/run-deep-crawl-facebook.ts tests/deep-crawl-facebook.test.ts
git commit -m "feat: rewrite Facebook deep-crawl for groups+VTV24 page, keyword extraction"
```

---

## Task 9: Delete sentiment classification entirely

**Files:**
- Delete: `src/run-classify-sentiment.ts`, `src/classify-sentiment.ts`, `src/lib/openai-sentiment-classifier.ts`, `tests/classify-sentiment.test.ts`, `tests/fakes/fake-sentiment-classifier.ts`
- Modify: `src/lib/topic-social-data-repository.ts` (drop `getUnclassifiedPosts`/`updateSentiment`)
- Modify: `tests/fakes/fake-topic-social-data-repository.ts` (drop the same 2 methods + `sentiment` field)
- Modify: `package.json` (remove `classify-sentiment` script)

**Interfaces:**
- Produces: `TopicSocialDataRepository` without `getUnclassifiedPosts`/`updateSentiment`.

- [ ] **Step 1: Delete the sentiment classification files**

```bash
git rm src/run-classify-sentiment.ts src/classify-sentiment.ts src/lib/openai-sentiment-classifier.ts tests/classify-sentiment.test.ts tests/fakes/fake-sentiment-classifier.ts
```

- [ ] **Step 2: Rewrite `topic-social-data-repository.ts`**

```typescript
// src/lib/topic-social-data-repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TopicSocialData } from '../types';

export interface TopicSocialDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<TopicSocialData>[]): Promise<{ error: string | null; count: number }>;
  getPostsForDate(date: string): Promise<TopicSocialData[]>;
}

export class SupabaseTopicSocialDataRepository implements TopicSocialDataRepository {
  constructor(private client: SupabaseClient) {}

  async hasDataForDate(date: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('topic_social_data')
      .select('id', { count: 'exact', head: true })
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async upsertPosts(rows: Partial<TopicSocialData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('topic_social_data')
      .upsert(rows, { onConflict: 'source,keyword,post_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }

  async getPostsForDate(date: string) {
    const { data, error } = await this.client
      .from('topic_social_data')
      .select('*')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as TopicSocialData[];
  }
}
```

- [ ] **Step 3: Rewrite the fake**

```typescript
// tests/fakes/fake-topic-social-data-repository.ts
import type { TopicSocialDataRepository } from '../../src/lib/topic-social-data-repository';
import type { TopicSocialData } from '../../src/types';

export class FakeTopicSocialDataRepository implements TopicSocialDataRepository {
  public posts: TopicSocialData[] = [];
  public upsertError: string | null = null;

  async hasDataForDate(date: string): Promise<boolean> {
    return this.posts.some((p) => p.date === date);
  }

  async upsertPosts(rows: Partial<TopicSocialData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.posts.push({
        id: row.id ?? crypto.randomUUID(),
        keyword: row.keyword!,
        source: row.source ?? 'threads',
        date: row.date!,
        post_url: row.post_url!,
        text_content: row.text_content ?? '',
        like_count: row.like_count ?? null,
        reply_count: row.reply_count ?? null,
        repost_count: row.repost_count ?? null,
        quote_count: row.quote_count ?? null,
        share_count: row.share_count ?? null,
        view_count: row.view_count ?? null,
        posted_at: row.posted_at ?? null,
      });
    }
    return { error: null, count: rows.length };
  }

  async getPostsForDate(date: string) {
    return this.posts.filter((p) => p.date === date);
  }
}
```

- [ ] **Step 4: Remove the npm script**

In `package.json`, delete the line:

```json
  "classify-sentiment": "tsx src/run-classify-sentiment.ts",
```

- [ ] **Step 5: Confirm `SentimentLabel` has zero remaining consumers, then remove it**

Run: `grep -rl "SentimentLabel" src/ --include=*.ts`
Expected: no matches (all 3 prior consumers — `types.ts`'s own fields, `topic-social-data-repository.ts`, `facebook-page-data-repository.ts`, the classifier files — are gone). If this is empty, delete the `export type SentimentLabel = 'positive' | 'negative' | 'neutral';` line from `src/types.ts`. If anything still matches, stop and investigate — do not delete the type while a real consumer remains.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck passes; only remaining test failures (if any) are pre-existing ones from Task 1's known list not yet addressed by earlier tasks — none should reference the files just deleted.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: delete sentiment classification (job, classifier, repository methods, SentimentLabel type)"
```

---

## Task 10: Reorder the GitHub Actions workflow, remove `classify-sentiment` job

**Files:**
- Modify: `.github/workflows/discovery-ingestion.yml`

**Interfaces:** none (CI config only).

- [ ] **Step 1: Rewrite the job graph**

Threads/Facebook deep-crawl no longer read `rank-and-select`'s shortlist (Task 3/8 removed that dependency) — they now write their OWN `candidate_topics` rows independently, same as `discovery-ingest`. `rank-and-select` must run AFTER all 3 writers so it computes `growth_rate`/`is_shortlisted` over every source's rows for the day, not just the 3 free ones. `classify-sentiment` is deleted (Task 9).

Replace the whole file with:

```yaml
name: Discovery ingestion

on:
  schedule:
    # 09:00 / 12:00 / 21:00 Vietnam time (ICT, UTC+7) — 1h after RSS
    # ingestion's schedule, so this doesn't contend for GitHub Actions
    # runners or read the articles table while ingest-rss is writing to it.
    - cron: '0 2,5,14 * * *'
  workflow_dispatch: {}

jobs:
  discovery-ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run discover
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

  deep-crawl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run deep-crawl
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}

  deep-crawl-facebook:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run deep-crawl-facebook
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}

  rank-and-select:
    needs: [discovery-ingest, deep-crawl, deep-crawl-facebook]
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run rank
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

  aggregate-engagement:
    needs: [deep-crawl, deep-crawl-facebook]
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run aggregate-engagement
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

Note what changed: `discovery-ingest`, `deep-crawl`, `deep-crawl-facebook` now run in parallel (no inter-dependency — each writes its own `candidate_topics` rows independently); `rank-and-select` moved to depend on all 3; `classify-sentiment` job removed entirely; `aggregate-engagement` unchanged (still only needs the 2 deep-crawl jobs, since engagement aggregation reads raw posts, not `candidate_topics`).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/discovery-ingestion.yml
git commit -m "feat: reorder discovery-ingestion workflow — deep-crawl jobs now independent of rank-and-select, remove classify-sentiment job"
```

---

## Task 11: Ingestion-side final verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: both pass, 0 failures.

- [ ] **Step 2: Grep for residual sentiment references in `src/`**

Run: `grep -rl "sentiment\|Sentiment" src/ tests/ --include=*.ts`
Expected: no matches. If any remain, they are a real gap Tasks 1-9 missed — fix before continuing to Task 12.

- [ ] **Step 3: Grep for the old 3-value source check assumption**

Run: `grep -rn "google_trends.*youtube.*rss'" src/ --include=*.ts`
Expected: no matches outside `src/types.ts` itself (the `DiscoverySourceName` declaration Task 1 already widened) — confirms no other file hardcodes the old 3-source list.

---

## Task 12: Dashboard — widen `CandidateTopic['source']`, update Record call sites

**Files:**
- Modify: `dashboard/lib/types.ts`
- Modify: `dashboard/lib/hot-topics.ts` (`groupBySource`'s `Record<CandidateTopic['source'], HotTopicRow[]>` literal)
- Modify: `dashboard/lib/hot-topic-format.ts` (`SOURCE_LABELS`)
- Modify: `dashboard/app/page.tsx`, `dashboard/app/[slug]/page.tsx` (any `bySource`-shaped object literal passed to `flattenAndRankHotTopics`/`buildHotTopicsOverview`/`buildHotTopicsForCategory` callers — these functions themselves don't need changes, only literals that enumerate all 3 keys need the 2 new ones)
- Test: `dashboard/tests/hot-topics.test.ts`, `dashboard/tests/hot-topic-format.test.ts`, `dashboard/tests/trending.test.ts` (extend fixtures)

**Interfaces:**
- Produces: `DiscoverySourceName = 'google_trends' | 'youtube' | 'rss' | 'threads' | 'facebook'` in `dashboard/lib/types.ts` (mirrors Task 1's `src/types.ts` change).

- [ ] **Step 1: Widen the type**

In `dashboard/lib/types.ts`:

```typescript
export type DiscoverySourceName = 'google_trends' | 'youtube' | 'rss' | 'threads' | 'facebook';
```

- [ ] **Step 2: Typecheck to find every call site that needs updating**

Run: `cd dashboard && npx tsc --noEmit`
Expected: FAILS at every `Record<CandidateTopic['source'], ...>` object literal that's missing the 2 new keys (TypeScript's excess/missing-property checking on object literals typed against a `Record` with a wider key union). Record the file list.

- [ ] **Step 3: Add the missing keys everywhere the compiler flagged**

In `dashboard/lib/hot-topics.ts`'s `groupBySource`:

```typescript
export function groupBySource(rows: HotTopicRow[]): Record<CandidateTopic['source'], HotTopicRow[]> {
  const grouped: Record<CandidateTopic['source'], HotTopicRow[]> = {
    google_trends: [],
    youtube: [],
    rss: [],
    threads: [],
    facebook: [],
  };
  for (const row of rows) {
    grouped[row.source].push(row);
  }
  for (const source of Object.keys(grouped) as CandidateTopic['source'][]) {
    grouped[source].sort((a, b) => (b.trendingScore ?? 0) - (a.trendingScore ?? 0));
  }
  return grouped;
}
```

In `dashboard/lib/hot-topic-format.ts`'s `SOURCE_LABELS`:

```typescript
export const SOURCE_LABELS: Record<CandidateTopic['source'], string> = {
  google_trends: 'Google Trends',
  youtube: 'YouTube',
  rss: 'RSS',
  threads: 'Threads',
  facebook: 'Facebook',
};
```

Then fix each remaining file Step 2 flagged — every `bySource`/`{ google_trends: ..., youtube: ..., rss: ... }` object literal in `app/page.tsx` and `app/[slug]/page.tsx` needs `threads: [...]` and `facebook: [...]` added the same way (empty array if that page doesn't independently fetch per-source, or the real value if it does — match whatever pattern the surrounding 3 keys already use in that file).

- [ ] **Step 4: Extend the test fixtures**

In `dashboard/tests/hot-topics.test.ts`, any test asserting the full shape of `groupBySource`'s return value (e.g. `expect(result).toEqual({ google_trends: [...], youtube: [...], rss: [...] })`) needs `threads: [], facebook: []` added to match. Same for `dashboard/tests/hot-topic-format.test.ts` if it snapshots `SOURCE_LABELS`'s full key set, and `dashboard/tests/trending.test.ts` if any test constructs a `bySource` literal missing the 2 new keys (the existing 5 tests in this file already only use `google_trends`/`youtube`/`rss` as partial `Record`s passed to `flattenAndRankHotTopics`, which are structurally fine since that function's signature — `Record<CandidateTopic['source'], EnrichedHotTopicRow[]>` — requires ALL 5 keys now; add `threads: [], facebook: []` to each existing test's `bySource` literal).

- [ ] **Step 5: Run tests**

Run: `cd dashboard && npx tsc --noEmit && npm test`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/types.ts dashboard/lib/hot-topics.ts dashboard/lib/hot-topic-format.ts dashboard/app/page.tsx "dashboard/app/[slug]/page.tsx" dashboard/tests/hot-topics.test.ts dashboard/tests/hot-topic-format.test.ts dashboard/tests/trending.test.ts
git commit -m "feat: widen dashboard CandidateTopic source type to include threads/facebook"
```

---

## Task 13: Dashboard — remove sentiment badge on hot-topics

**Files:**
- Modify: `dashboard/lib/hot-topic-format.ts` (remove `sentimentBadgeClass`, `formatSentimentBadge`)
- Modify: `dashboard/components/TrendingTable.tsx` (remove the badge JSX + import)
- Modify: `dashboard/tests/hot-topic-format.test.ts` (remove the 2 functions' tests)

- [ ] **Step 1: Remove the 2 functions from `hot-topic-format.ts`**

Delete `sentimentBadgeClass` and `formatSentimentBadge` (both currently at the bottom of the file, after `formatTrendingScore`) — leave `SOURCE_LABELS`, `formatPercent`, `formatTrendingScore` untouched.

- [ ] **Step 2: Remove the badge from `TrendingTable.tsx`**

Change the import line from:

```typescript
import { SOURCE_LABELS, formatTrendingScore, sentimentBadgeClass, formatSentimentBadge } from '../lib/hot-topic-format';
```

to:

```typescript
import { SOURCE_LABELS, formatTrendingScore } from '../lib/hot-topic-format';
```

Remove the conditional badge block that reads `row.engagement.sentimentIndex`:

```tsx
{row.engagement && row.engagement.sentimentIndex !== null ? (
  <span
    className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0 ${sentimentBadgeClass(row.engagement.sentimentIndex)}`}
  >
    {formatSentimentBadge(row.engagement.sentimentIndex)}
  </span>
) : null}
```

(This block's exact surrounding JSX depends on the file's current layout — find it via `grep -n sentimentIndex dashboard/components/TrendingTable.tsx` and delete just that conditional, keeping every sibling element.)

- [ ] **Step 3: Remove the corresponding tests**

In `dashboard/tests/hot-topic-format.test.ts`, delete the `describe('sentimentBadgeClass', ...)` and `describe('formatSentimentBadge', ...)` blocks (or their equivalent `it(...)` cases if not grouped under a `describe`).

- [ ] **Step 4: Run tests**

Run: `cd dashboard && npm test -- hot-topic-format`
Expected: PASS, no failures from the deleted functions.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/hot-topic-format.ts dashboard/components/TrendingTable.tsx dashboard/tests/hot-topic-format.test.ts
git commit -m "feat: remove sentiment badge from hot-topics table"
```

---

## Task 14: Dashboard — strip sentiment out of `topic-engagement.ts`/`facebook-summary.ts`

**Files:**
- Modify: `dashboard/lib/topic-engagement.ts`
- Modify: `dashboard/lib/facebook-summary.ts`
- Modify: `dashboard/lib/get-facebook-summary.ts`
- Modify: `dashboard/components/FacebookSummarySection.tsx`, `dashboard/components/SentimentBar.tsx` (delete — see Step 5)
- Modify: `dashboard/app/[slug]/page.tsx` (the `getFacebookSummary` call site)
- Modify: `dashboard/lib/get-hot-topics.ts` (the `attachEngagement` call site — drops the sentiment map argument)
- Test: `dashboard/tests/topic-engagement.test.ts`, `dashboard/tests/facebook-summary.test.ts`, `dashboard/tests/get-facebook-summary.test.ts`, `dashboard/tests/get-topic-engagement.test.ts`

**Interfaces:**
- Produces: `TopicEngagement = { totalEngagement: number; postCount: number }` (drops `sentiment`/`sentimentIndex`). `attachEngagement(rows, engagementByKeyword): EnrichedHotTopicRow[]` (drops the `sentimentByKeyword` 3rd param). `FacebookSummary = { totalEngagement: number; postCount: number }` (drops `sentiment`/`sentimentIndex`). `buildFacebookSummary(category, engagementRows): FacebookSummary | null` (drops the `sentimentByCategory` 3rd param). `getFacebookSummary(category, engagementReader, date): Promise<FacebookSummary | null>` (drops the `sentimentReader` param).

- [ ] **Step 1: Strip `topic-engagement.ts`**

```typescript
// dashboard/lib/topic-engagement.ts
import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic, ThreadsEngagementDaily } from './types';

export interface TopicEngagement {
  totalEngagement: number; // like+reply+repost+quote+share, view_count excluded
  postCount: number;
}

export interface EnrichedHotTopicRow extends HotTopicRow {
  engagement: TopicEngagement | null;
}

export function threadsEngagementTotal(row: ThreadsEngagementDaily): number {
  return (
    row.total_like_count +
    row.total_reply_count +
    row.total_repost_count +
    row.total_quote_count +
    row.total_share_count
  );
}

export function attachEngagement(
  rows: HotTopicRow[],
  engagementByKeyword: Map<string, ThreadsEngagementDaily>
): EnrichedHotTopicRow[] {
  return rows.map((row) => {
    const engagementRow = engagementByKeyword.get(row.keyword);
    if (!engagementRow) {
      return { ...row, engagement: null };
    }
    return {
      ...row,
      engagement: {
        totalEngagement: threadsEngagementTotal(engagementRow),
        postCount: engagementRow.post_count,
      },
    };
  });
}

export function withoutEngagement(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>
): Record<CandidateTopic['source'], EnrichedHotTopicRow[]> {
  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const result = {} as Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
  for (const source of sources) {
    result[source] = bySource[source].map((row) => ({ ...row, engagement: null }));
  }
  return result;
}
```

(`SentimentCounts`, `groupSentimentCounts`, `computeSentimentIndex`, `countAllSentiment` are deleted — check their other consumers before deleting: `overview-metrics.ts` (Task 16), `sentiment-by-category.ts`/`sentiment-trend.ts` (Tasks 15/16, deleted whole), `facebook-summary.ts` (this task, Step 2). Only delete these 4 exports after Task 16 also lands, since `overview-metrics.ts`'s `computeSentimentIndex`/`countAllSentiment` usage is removed there, not here — for THIS task, leave those 4 exports in place and only touch `TopicEngagement`/`EnrichedHotTopicRow`/`attachEngagement`/`withoutEngagement` as shown above.)

- [ ] **Step 2: Strip `facebook-summary.ts`**

```typescript
// dashboard/lib/facebook-summary.ts
import type { FacebookEngagementDaily } from './types';

export interface FacebookSummary {
  totalEngagement: number; // like+comment+share
  postCount: number;
}

export function facebookEngagementTotal(row: FacebookEngagementDaily): number {
  return row.total_like_count + row.total_comment_count + row.total_share_count;
}

export function buildFacebookSummary(
  category: string,
  engagementRows: FacebookEngagementDaily[]
): FacebookSummary | null {
  const engagementRow = engagementRows.find((r) => r.category === category);
  if (!engagementRow) return null;

  return {
    totalEngagement: facebookEngagementTotal(engagementRow),
    postCount: engagementRow.post_count,
  };
}
```

- [ ] **Step 3: Strip `get-facebook-summary.ts`**

```typescript
// dashboard/lib/get-facebook-summary.ts
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import { buildFacebookSummary, type FacebookSummary } from './facebook-summary';

export async function getFacebookSummary(
  category: string,
  engagementReader: FacebookEngagementReader,
  date: string
): Promise<FacebookSummary | null> {
  const engagementRows = await engagementReader.getForDate(date);
  return buildFacebookSummary(category, engagementRows);
}
```

- [ ] **Step 4: Update the sector page's call site**

In `dashboard/app/[slug]/page.tsx`, change:

```typescript
return await getFacebookSummary(category, new SupabaseFacebookEngagementReader(client), new SupabaseFacebookSentimentReader(client), date);
```

to:

```typescript
return await getFacebookSummary(category, new SupabaseFacebookEngagementReader(client), date);
```

Remove the now-unused `import { SupabaseThreadsSentimentReader } from '../../lib/threads-sentiment-reader';` and `import { SupabaseFacebookSentimentReader } from '../../lib/facebook-sentiment-reader';` lines from this file (they're deleted entirely in Task 17 — removing the imports here now prevents a dangling reference in between tasks; if this task runs before Task 17, this import removal will itself need the sentiment-reader files to still exist until Task 17 deletes them, which is fine since this task only stops *using* them here, not deleting the files).

- [ ] **Step 5: Delete `SentimentBar.tsx`, strip `FacebookSummarySection.tsx`**

```bash
git rm dashboard/components/SentimentBar.tsx
```

```tsx
// dashboard/components/FacebookSummarySection.tsx
import type { FacebookSummary } from '../lib/facebook-summary';

export function FacebookSummarySection({ summary, date }: { summary: FacebookSummary | null; date: string | null }) {
  const heading = date === null ? 'Facebook' : `Facebook (${date})`;

  if (summary === null) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
        <h2 className="text-base font-bold text-ink mb-2">{heading}</h2>
        <p className="text-sm text-ink-3">Chưa có dữ liệu Facebook hôm nay.</p>
      </section>
    );
  }

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
      <h2 className="text-base font-bold text-ink mb-4">
        {heading}: {summary.postCount} bài · {summary.totalEngagement.toLocaleString('vi-VN')} tương tác
      </h2>
    </section>
  );
}
```

- [ ] **Step 6: Update `get-hot-topics.ts`'s `attachEngagement` call**

Find the call site (`grep -n attachEngagement dashboard/lib/get-hot-topics.ts`) and remove its 3rd argument (the sentiment map) — the sentiment-by-keyword `Map` construction feeding it becomes dead code; remove that too, along with whatever `ThreadsSentimentReader` import/fetch fed it (this overlaps Task 17's fuller sentiment-reader removal — if Task 17 hasn't run yet, leave the reader import/fetch in place here and just stop passing its result into `attachEngagement`; Task 17 finishes the removal).

- [ ] **Step 7: Update tests**

In `dashboard/tests/topic-engagement.test.ts`: remove test cases asserting `sentiment`/`sentimentIndex` on `attachEngagement`'s output; update remaining `attachEngagement(...)` calls to drop the 3rd argument.
In `dashboard/tests/facebook-summary.test.ts`: remove `sentimentByCategory`-argument test cases; update remaining `buildFacebookSummary(...)` calls to drop the 3rd argument; remove `sentiment`/`sentimentIndex` assertions.
In `dashboard/tests/get-facebook-summary.test.ts`: remove the `sentimentReader` fake wiring and its 3rd-argument usage in `getFacebookSummary(...)` calls.
In `dashboard/tests/get-topic-engagement.test.ts`: same pattern — drop sentiment-reader wiring feeding `attachEngagement`.

- [ ] **Step 8: Run tests**

Run: `cd dashboard && npm test -- topic-engagement facebook-summary get-facebook-summary get-topic-engagement`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add dashboard/lib/topic-engagement.ts dashboard/lib/facebook-summary.ts dashboard/lib/get-facebook-summary.ts "dashboard/app/[slug]/page.tsx" dashboard/lib/get-hot-topics.ts dashboard/components/FacebookSummarySection.tsx dashboard/tests/topic-engagement.test.ts dashboard/tests/facebook-summary.test.ts dashboard/tests/get-facebook-summary.test.ts dashboard/tests/get-topic-engagement.test.ts
git rm dashboard/components/SentimentBar.tsx 2>/dev/null; git add -A
git commit -m "feat: strip sentiment out of topic engagement and Facebook summary"
```

---

## Task 15: Dashboard — remove Sentiment by Category

**Files:**
- Delete: `dashboard/lib/sentiment-by-category.ts`, `dashboard/components/SentimentByCategorySection.tsx`, `dashboard/tests/sentiment-by-category.test.ts`
- Modify: `dashboard/app/page.tsx` (Overview — remove the loader + JSX branch)

- [ ] **Step 1: Delete the files**

```bash
git rm dashboard/lib/sentiment-by-category.ts dashboard/components/SentimentByCategorySection.tsx dashboard/tests/sentiment-by-category.test.ts
```

- [ ] **Step 2: Remove wiring in `app/page.tsx`**

Remove the import `import { computeSentimentByCategory, type CategorySentiment } from '../lib/sentiment-by-category';` and `import { SentimentByCategorySection } from '../components/SentimentByCategorySection';`.

Remove the `loadSentimentByCategory` function (currently reading `candidates`/`threadsSentiment`/`facebookSentiment` and calling `computeSentimentByCategory`).

Remove `sentimentByCategory` from the destructured `Promise.all` result and its corresponding promise in the array.

In the JSX, find the block:

```tsx
{sentimentByCategory || buzzByPlatform ? (
  <...>
    {sentimentByCategory ? (
      <SentimentByCategorySection data={sentimentByCategory} />
    ) : ...}
```

and simplify it to render `BuzzByPlatformSection` unconditionally on `buzzByPlatform` alone (matching whatever fallback message the `buzzByPlatform`-only branch already uses elsewhere on this page for a failed load — grep for `Chưa có dữ liệu` near this block to match the existing pattern verbatim).

- [ ] **Step 3: Run tests**

Run: `cd dashboard && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove Sentiment by Category section from Overview"
```

---

## Task 16: Dashboard — remove Sentiment Trend + Sentiment Score/Index KPI

**Files:**
- Delete: `dashboard/lib/sentiment-trend.ts`, `dashboard/components/SentimentTrendChart.tsx`, `dashboard/tests/sentiment-trend.test.ts`
- Modify: `dashboard/lib/overview-metrics.ts`, `dashboard/lib/get-overview-metrics.ts`, `dashboard/components/OverviewMetricsSection.tsx`
- Modify: `dashboard/app/analytics/page.tsx`
- Modify: `dashboard/lib/metric-tooltips.ts` (remove `sentimentScore`, `sentimentTrend`, `topicDetailSentiment` keys — the last one only after Task 17 confirms it has no other consumer)
- Test: `dashboard/tests/overview-metrics.test.ts`, `dashboard/tests/get-overview-metrics.test.ts`

**Interfaces:**
- Produces: `OverviewMetrics = { buzzVolume: number; topicsTrending: number; audienceScale: number }` (drops `sentimentScore`). `computeOverviewMetrics(candidates, articles, threadsRows, facebookRows): OverviewMetrics` (drops the `sentimentRows` 5th param).

- [ ] **Step 1: Delete Sentiment Trend files**

```bash
git rm dashboard/lib/sentiment-trend.ts dashboard/components/SentimentTrendChart.tsx dashboard/tests/sentiment-trend.test.ts
```

- [ ] **Step 2: Strip `overview-metrics.ts`**

Remove `sentimentScore: number | null;` from the metrics interface, remove the `sentimentRows` parameter and its `countAllSentiment`/`computeSentimentIndex` usage from the compute function, and drop those 2 now-unused imports from `./topic-engagement`.

- [ ] **Step 3: Update `get-overview-metrics.ts`**

Remove the `threadsSentimentReader`/`facebookSentimentReader` parameters and their `getForDate` calls; remove the `sentimentRows` construction; update the `computeOverviewMetrics(...)` call to drop its 5th argument. Remove the now-dangling `ThreadsSentimentReader`/`FacebookSentimentReader` type imports (leave the reader files themselves for Task 17 to delete).

- [ ] **Step 4: Remove the Sentiment Score KPI card**

In `dashboard/components/OverviewMetricsSection.tsx`: delete `formatSentimentScore`, the `sentimentScore` entry in the icon/label config object, and the `<KpiCard label="Sentiment Score" ... />` JSX block.

- [ ] **Step 5: Remove Sentiment Index KPI + Sentiment Trend panel from Analytics**

In `dashboard/app/analytics/page.tsx`: remove the imports for `SupabaseThreadsSentimentReader`/`SupabaseFacebookSentimentReader`/`computeSentimentTrend`/`SentimentTrendPoint`/`SentimentTrendChart`; remove `loadSentimentTrend` and its call in the `Promise.all`/conditional-fetch block; remove the `<KpiCard label="Sentiment Index" .../>` block; remove the "Xu hướng Sentiment" panel (the `<MetricTooltip text={METRIC_TOOLTIPS.sentimentTrend} />`/`<SentimentTrendChart data={sentimentTrend} />` block and its surrounding heading/container).

- [ ] **Step 6: Trim `metric-tooltips.ts`**

Remove the `sentimentScore` and `sentimentTrend` keys from `METRIC_TOOLTIPS`. Leave `topicDetailSentiment` for Task 17 (it's still referenced by Topic Detail until that task removes the reference).

- [ ] **Step 7: Update tests**

In `dashboard/tests/overview-metrics.test.ts`: remove `sentimentScore` assertions and the `sentimentRows` argument from every `computeOverviewMetrics(...)` call.
In `dashboard/tests/get-overview-metrics.test.ts`: remove sentiment-reader fake wiring and `sentimentScore` assertions.

- [ ] **Step 8: Run tests**

Run: `cd dashboard && npx tsc --noEmit && npm test`
Expected: PASS (some failures are expected here if Task 17 hasn't run yet and Topic Detail still imports something Step 6 didn't touch — `topicDetailSentiment` was deliberately left alone, so this should be clean).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove Sentiment Trend chart and Sentiment Score/Index KPI"
```

---

## Task 17: Dashboard — remove sentiment readers + Topic Detail sentiment

**Files:**
- Delete: `dashboard/lib/threads-sentiment-reader.ts`, `dashboard/lib/facebook-sentiment-reader.ts`, `dashboard/tests/fakes/fake-threads-sentiment-reader.ts`, `dashboard/tests/fakes/fake-facebook-sentiment-reader.ts`
- Modify: `dashboard/lib/topic-detail.ts`, `dashboard/lib/get-topic-detail.ts`, `dashboard/app/topic/[keyword]/page.tsx`
- Modify: `dashboard/lib/metric-tooltips.ts` (remove `topicDetailSentiment`)
- Modify: `dashboard/app/page.tsx`, `dashboard/lib/get-hot-topics.ts` (finish removing the sentiment-reader wiring Tasks 13/14/15 left in place — grep to confirm no import of either deleted reader file remains anywhere)
- Test: `dashboard/tests/topic-detail.test.ts`, `dashboard/tests/topic-detail-readers.test.ts`, `dashboard/tests/get-topic-detail.test.ts`

**Interfaces:**
- Produces: `TopicDetail` without `sentimentTimeline`. `computeTopicDetail(keyword, candidateHistory, threadsRows, dates): TopicDetail` (drops the `sentimentRows` 4th param). `getTopicDetail(keyword, candidateRepo, threadsEngagementReader, date): Promise<TopicDetail>` (drops the `threadsSentimentReader` param).

- [ ] **Step 1: Confirm every remaining consumer of the 2 sentiment readers**

Run: `grep -rln "threads-sentiment-reader\|facebook-sentiment-reader\|ThreadsSentimentReader\|FacebookSentimentReader" dashboard --include=*.ts --include=*.tsx`
Expected: a list including `topic-detail.ts`, `get-topic-detail.ts`, `app/topic/[keyword]/page.tsx`, `app/page.tsx`, `get-hot-topics.ts`, and their test files (all of which Tasks 13-16 partially touched, or this task fully resolves) — treat this list as the authoritative to-do for Steps 2-5, since file layouts can drift between when this plan was written and when this task runs.

- [ ] **Step 2: Strip `topic-detail.ts` and `get-topic-detail.ts`**

In `dashboard/lib/topic-detail.ts`: remove `sentimentTimeline` from the returned shape, remove the `threadsSentimentRows` parameter and the loop building `sentimentTimeline` from it, remove the now-unused `SentimentLabel` import.

In `dashboard/lib/get-topic-detail.ts`: remove the `threadsSentimentReader` parameter and its `getForDateRange` call, remove `keywordSentimentRows` construction, update the `computeTopicDetail(...)` call to drop that argument, remove the `ThreadsSentimentReader` type import.

- [ ] **Step 3: Update `app/topic/[keyword]/page.tsx`**

Remove the `SupabaseThreadsSentimentReader` import and its instantiation in the `getTopicDetail(...)` call's argument list. Remove the `computeSentimentIndex` import if this was its only remaining use in the file (check with `grep -n computeSentimentIndex` in this file). Remove the "Sentiment Threads — 7 ngày qua" panel: the heading, its `<MetricTooltip text={METRIC_TOOLTIPS.topicDetailSentiment} />`, and the chart reading `detail.sentimentTimeline`.

- [ ] **Step 4: Finish removing wiring left in `app/page.tsx` and `get-hot-topics.ts`**

Remove `SupabaseThreadsSentimentReader`/`SupabaseFacebookSentimentReader` imports and instantiations from both files (Task 14 Step 6 and Task 15 left some of this in place deliberately, pending this task).

- [ ] **Step 5: Delete the reader files and their fakes**

```bash
git rm dashboard/lib/threads-sentiment-reader.ts dashboard/lib/facebook-sentiment-reader.ts dashboard/tests/fakes/fake-threads-sentiment-reader.ts dashboard/tests/fakes/fake-facebook-sentiment-reader.ts
```

- [ ] **Step 6: Remove `topicDetailSentiment` from tooltips**

In `dashboard/lib/metric-tooltips.ts`, remove the `topicDetailSentiment` key.

- [ ] **Step 7: Update tests**

In `dashboard/tests/topic-detail.test.ts`: remove `sentimentTimeline` assertions and the `threadsSentimentRows` argument from every `computeTopicDetail(...)` call.
`dashboard/tests/topic-detail-readers.test.ts`: this file's name suggests it may test `threads-sentiment-reader.ts` directly — if so, delete it entirely (`git rm`); if it also covers a reader that survives (e.g. `ThreadsEngagementReader`), keep only that portion.
`dashboard/tests/get-topic-detail.test.ts`: remove sentiment-reader fake wiring and assertions.

- [ ] **Step 8: Run full dashboard test suite + typecheck**

Run: `cd dashboard && npx tsc --noEmit && npm test`
Expected: PASS, 0 failures.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove sentiment readers and Topic Detail sentiment panel"
```

---

## Task 18: Dashboard — clean up `/help` page text

**Files:**
- Modify: `dashboard/app/help/page.tsx`

- [ ] **Step 1: Remove the sentiment-specific glossary entries**

Remove the `<MetricItem name="Sentiment Score">` block and the `<MetricItem name="Sentiment badge">` block entirely (grep confirmed these exist at roughly lines 52 and 83 in the file as of this plan — confirm exact location with `grep -n "Sentiment" dashboard/app/help/page.tsx` before editing, since earlier tasks may have shifted line numbers).

Remove the `<MetricItem name="Sentiment Threads — 7 ngày qua">` block (Topic Detail's now-deleted panel).

Remove or rewrite the standalone `"Sentiment được phân tích như thế nào?"` explainer section (the one describing the LLM classification retry behavior) — this describes a feature that no longer exists; delete the whole section rather than editing it to describe something else, since sentiment analysis itself is gone, not just relocated.

For any remaining prose elsewhere on the page that mentions "sentiment Tích cực/Trung lập/Tiêu cực" in passing (e.g. describing what a hot-topics row used to show), rewrite that sentence to describe the current behavior instead of deleting the surrounding paragraph if the paragraph is otherwise still accurate (e.g. a paragraph explaining Threads engagement/keyword extraction that happens to mention sentiment as an aside).

- [ ] **Step 2: Verify no dangling references**

Run: `grep -n "Sentiment\|sentiment" dashboard/app/help/page.tsx`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/help/page.tsx
git commit -m "docs: remove sentiment content from /help page"
```

---

## Task 19: Dashboard — final verification

**Files:** none (verification only).

- [ ] **Step 1: Full dashboard test suite + typecheck + build**

Run: `cd dashboard && npx tsc --noEmit && npm test && npm run build`
Expected: all 3 pass, 0 failures, build succeeds.

- [ ] **Step 2: Grep for residual sentiment references across the whole dashboard**

Run: `grep -rl "sentiment\|Sentiment" dashboard/lib dashboard/components dashboard/app dashboard/tests --include=*.ts --include=*.tsx`
Expected: no matches. Any hit here is a real gap in Tasks 12-18 — fix it before considering this plan complete.

- [ ] **Step 2b: Confirm `SentimentLabel`/`SentimentCounts`/`groupSentimentCounts`/`computeSentimentIndex`/`countAllSentiment` have zero remaining consumers**

Run: `grep -rn "SentimentLabel\|SentimentCounts\|groupSentimentCounts\|computeSentimentIndex\|countAllSentiment" dashboard --include=*.ts --include=*.tsx`
Expected: no matches outside their own declarations in `dashboard/lib/types.ts`/`dashboard/lib/topic-engagement.ts` — if truly zero external consumers, delete these 5 declarations too (they were deliberately left in place through Tasks 14-17 since multiple files consumed them until this point).

- [ ] **Step 3: Grep the whole repo (both `src/` and `dashboard/`) for the deleted `sentiment` DB column**

Run: `grep -rn "\.sentiment\b" src/ dashboard/ --include=*.ts --include=*.tsx`
Expected: no matches — confirms no code still reads a `sentiment` field off `TopicSocialData`/`FacebookPageData`/any Supabase row shape.

- [ ] **Step 4: Commit any final cleanup from Steps 2b/2**

```bash
git add -A
git commit -m "chore: remove now-fully-unused sentiment types and helpers" --allow-empty
```

(Use `--allow-empty` only if Steps 2/2b found nothing to clean up and this commit would otherwise be empty — otherwise omit the flag.)

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** §1-§4 (Threads) → Tasks 2-3. §5 (Facebook, incl. §5.1b VTV24 exception) → Tasks 4-8. §6 (schema) → Task 1, 7. §7 (budget) → encoded as Global Constraints, no code enforces a dollar cap (matches existing `maxTotalChargeUsd` per-call caps, which are the actual enforcement mechanism, carried over unchanged in Tasks 4/5/8). §8 (dashboard sentiment removal, engagement kept) → Tasks 12-18. §9 (deferred items — 2nd giai_tri group, TikTok) → deliberately NOT tasks in this plan, left as spec-documented future work. §10 (file structure) → mirrored in this plan's File Structure section and each task's Files block.
- **Judgment calls beyond the spec** (spec didn't specify these exactly; decided here, consistent with spec's binding decisions): (1) `deep-crawl.ts`/`deep-crawl-facebook.ts` write `candidate_topics` directly via `upsertCandidates` rather than routing through `discovery-ingest.ts`'s `ingestDiscoverySource`/`DiscoverySource` abstraction — that abstraction's LLM-classification-fallback machinery is unnecessary here since category is always known for certain from the seed, and forcing the fit would require Threads/Facebook's per-query/per-seed error isolation and idempotency guard to fight that abstraction's own single-fetch-call shape. (2) The GitHub Actions workflow reorder (Task 10) — spec said "rank-and-select.ts không cần sửa logic" but didn't address job ordering; since deep-crawl no longer needs rank-and-select's shortlist, and its own new rows DO need rank-and-select's growth_rate computation, rank-and-select must move to run after all 3 writer jobs, not before. (3) The Facebook groups client reuses the existing `FacebookPageScrapeClient` interface (Task 4) rather than the spec's `FacebookGroupPost`-as-a-separate-type sketch, since the verified real field shapes for groups and pages are structurally identical.
- **Placeholder scan:** no TBD/TODO in any task; every code step above is complete, runnable code, not a description of what to write.
- **Type consistency:** `RawCandidate.knownCategories` (existing field, `src/types.ts`) is reused by both `aggregateThreadsKeywords` and `aggregateFacebookKeywords` to carry a certain-not-guessed category — matches its existing doc comment ("Category already known from the source itself"). `DeepCrawlResult`/`DeepCrawlFacebookResult` field names (`queriesRun`/`candidatesUpserted`/`postsUpserted`/`seedsAttempted`) are used identically across Task 3/8's implementation, tests, and `run-deep-crawl*.ts` log lines.
