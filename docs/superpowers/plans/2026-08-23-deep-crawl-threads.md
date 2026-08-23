# Deep-crawl Threads (sub-project 2b v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Threads-only Apify deep-crawl step that reads today's shortlisted `candidate_topics`, picks up to 8 of them (per-category floor + fill), searches Threads for each via Apify, and stores the resulting posts in a new `topic_social_data` table.

**Architecture:** A 3rd job (`deep-crawl`) appended to the existing `discovery-ingestion.yml` workflow, after `rank-and-select`. Pure-logic modules (topic selection, orchestration) are unit-tested via fakes, matching the discovery layer's established shape (`discovery-ingest.ts` + `run-discovery-ingest.ts`, `CandidateTopicRepository` + `FakeCandidateTopicRepository`). The only untested-by-design piece is the thin Apify HTTP client, matching this codebase's existing convention for direct external-I/O wrappers (`youtube-search-client.ts`, `article-extractor.ts` — neither has a test file).

**Tech Stack:** TypeScript, `tsx`, Vitest, `@supabase/supabase-js`, native `fetch` (no new npm dependency — same convention as the rest of this codebase).

**Spec:** `docs/superpowers/specs/2026-08-23-deep-crawl-threads-design.md`

## Global Constraints

- No new npm dependencies — call Apify via native `fetch()`, same as every other external API in this codebase (YouTube, OpenAI).
- Per-topic try/catch isolation everywhere a loop calls out to Apify or the database — one topic's failure must never abort the rest (established pattern throughout `discovery-ingest.ts`/`ingest-rss.ts`).
- `maxTotalChargeUsd: 0.5` on every Apify call — hard safety cap, non-negotiable per spec §6.
- `FETCH_TIMEOUT_MS = 120000` for the Apify client (not this codebase's usual 15000 — real Apify runs measured at 1-2+ minutes).
- Idempotency guard (has `topic_social_data` got rows for today's date already?) at the top of the orchestration function — never hardcode "only run at hour X".
- Actor id: `futurizerush~meta-threads-scraper`. Endpoint: `POST https://api.apify.com/v2/acts/futurizerush~meta-threads-scraper/run-sync-get-dataset-items?token=...`.
- Selection is hard-capped at 8 topics/day total (not additive like `rank-and-select.ts`'s per-category floor).

---

### Task 1: `topic_social_data` migration

**Files:**
- Create: `supabase/migrations/0004_add_topic_social_data.sql`

**Interfaces:**
- Produces: the `topic_social_data` table that Task 2's repository reads/writes.

- [ ] **Step 1: Write the migration**

```sql
create table if not exists topic_social_data (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  source text not null check (source in ('threads')),
  date date not null,
  post_url text not null,
  text_content text not null default '',
  like_count integer,
  reply_count integer,
  repost_count integer,
  quote_count integer,
  share_count integer,
  view_count integer,
  posted_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (source, keyword, post_url)
);

create index if not exists topic_social_data_date_idx
  on topic_social_data (date);

alter table topic_social_data enable row level security;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0004_add_topic_social_data.sql
git commit -m "feat: add topic_social_data migration"
```

Note for the human operator (not an automated step — same as migrations `0001`-`0003`): apply this file to the live Supabase project via the SQL Editor before the `deep-crawl` job (Task 8) is deployed, otherwise every run will fail at the first query.

---

### Task 2: `TopicSocialData` type + `TopicSocialDataRepository` + fake

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/topic-social-data-repository.ts`
- Create: `tests/fakes/fake-topic-social-data-repository.ts`
- Test: `tests/fake-topic-social-data-repository.test.ts`

**Interfaces:**
- Produces: `TopicSocialData` (type), `TopicSocialDataRepository` interface with `hasDataForDate(date: string): Promise<boolean>` and `upsertPosts(rows: Partial<TopicSocialData>[]): Promise<{ error: string | null; count: number }>`, `SupabaseTopicSocialDataRepository`, `FakeTopicSocialDataRepository`.
- Consumes: nothing (leaf module, same level as `CandidateTopicRepository`).

- [ ] **Step 1: Add the type to `src/types.ts`**

Append to the end of `src/types.ts`:

```typescript
export type DeepCrawlSourceName = 'threads';

export interface TopicSocialData {
  id?: string;
  keyword: string;
  source: DeepCrawlSourceName;
  date: string;
  post_url: string;
  text_content: string;
  like_count: number | null;
  reply_count: number | null;
  repost_count: number | null;
  quote_count: number | null;
  share_count: number | null;
  view_count: number | null;
  posted_at: string | null;
  fetched_at?: string;
}
```

- [ ] **Step 2: Write the failing test for the fake**

Create `tests/fake-topic-social-data-repository.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';

describe('FakeTopicSocialDataRepository', () => {
  it('upsertPosts adds every row in the batch', async () => {
    const repo = new FakeTopicSocialDataRepository();
    const { error, count } = await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/2' },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(2);
    expect(repo.posts).toHaveLength(2);
  });

  it('hasDataForDate returns true only when a row exists for that date', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    expect(await repo.hasDataForDate('2026-08-23')).toBe(true);
    expect(await repo.hasDataForDate('2026-08-22')).toBe(false);
  });

  it('upsertPosts returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeTopicSocialDataRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.posts).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/fake-topic-social-data-repository.test.ts`
Expected: FAIL — `Cannot find module './fakes/fake-topic-social-data-repository'`

- [ ] **Step 4: Write `src/lib/topic-social-data-repository.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TopicSocialData } from '../types';

export interface TopicSocialDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<TopicSocialData>[]): Promise<{ error: string | null; count: number }>;
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
}
```

- [ ] **Step 5: Write `tests/fakes/fake-topic-social-data-repository.ts`**

```typescript
import type { TopicSocialDataRepository } from '../../src/lib/topic-social-data-repository';
import type { TopicSocialData } from '../../src/types';

export class FakeTopicSocialDataRepository implements TopicSocialDataRepository {
  public posts: TopicSocialData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl's batch
  // error handling without a real database.
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
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/fake-topic-social-data-repository.test.ts && npx tsc --noEmit`
Expected: 3 tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/lib/topic-social-data-repository.ts tests/fakes/fake-topic-social-data-repository.ts tests/fake-topic-social-data-repository.test.ts
git commit -m "feat: add TopicSocialData type and repository"
```

---

### Task 3: `selectDeepCrawlTopics` pure function

**Files:**
- Create: `src/lib/select-deep-crawl-topics.ts`
- Test: `tests/select-deep-crawl-topics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopic` (from `src/types.ts`, already exists — has `keyword`, `growth_rate`, `category_hint`, `is_shortlisted`, `source`).
- Produces: `selectDeepCrawlTopics(candidates: CandidateTopic[]): string[]` — used by Task 5's orchestration.

- [ ] **Step 1: Write the failing tests**

Create `tests/select-deep-crawl-topics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { selectDeepCrawlTopics } from '../src/lib/select-deep-crawl-topics';
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

describe('selectDeepCrawlTopics', () => {
  it('ignores candidates that are not shortlisted', () => {
    const result = selectDeepCrawlTopics([
      candidate({ keyword: 'a', is_shortlisted: false, growth_rate: 100 }),
      candidate({ keyword: 'b', is_shortlisted: true, growth_rate: 1 }),
    ]);
    expect(result).toEqual(['b']);
  });

  it('dedupes a keyword appearing under multiple sources, keeping it once', () => {
    const result = selectDeepCrawlTopics([
      candidate({ keyword: 'bitcoin', source: 'google_trends', growth_rate: 1 }),
      candidate({ keyword: 'bitcoin', source: 'rss', growth_rate: 5 }),
    ]);
    expect(result).toEqual(['bitcoin']);
  });

  it('reserves top-2 per category even if they would miss the overall top-8 by growth_rate', () => {
    // 8 high-growth candidates with no category fill the general pool, but a
    // low-growth du_lich candidate must still get one of the 8 slots.
    const generic = Array.from({ length: 8 }, (_, i) =>
      candidate({ keyword: `generic${i}`, growth_rate: 100 - i, category_hint: [] })
    );
    const travel = candidate({ keyword: 'da-lat', growth_rate: 0.1, category_hint: ['du_lich'] });
    const result = selectDeepCrawlTopics([...generic, travel]);
    expect(result).toContain('da-lat');
    expect(result).toHaveLength(8);
  });

  it('fills remaining slots up to 8 by growth_rate after the per-category floor', () => {
    const finance1 = candidate({ keyword: 'f1', growth_rate: 10, category_hint: ['tai_chinh'] });
    const finance2 = candidate({ keyword: 'f2', growth_rate: 9, category_hint: ['tai_chinh'] });
    const generic = Array.from({ length: 5 }, (_, i) =>
      candidate({ keyword: `generic${i}`, growth_rate: 8 - i, category_hint: [] })
    );
    const result = selectDeepCrawlTopics([finance1, finance2, ...generic]);
    expect(result).toHaveLength(7); // 2 finance + 5 generic, total shortlisted < 8
    expect(result).toEqual(expect.arrayContaining(['f1', 'f2', 'generic0', 'generic1', 'generic2', 'generic3', 'generic4']));
  });

  it('caps at 8 total even when more than 8 shortlisted candidates exist', () => {
    const generic = Array.from({ length: 12 }, (_, i) =>
      candidate({ keyword: `generic${i}`, growth_rate: 12 - i, category_hint: [] })
    );
    const result = selectDeepCrawlTopics(generic);
    expect(result).toHaveLength(8);
    expect(result).toEqual(['generic0', 'generic1', 'generic2', 'generic3', 'generic4', 'generic5', 'generic6', 'generic7']);
  });

  it('returns an empty array when nothing is shortlisted', () => {
    const result = selectDeepCrawlTopics([candidate({ is_shortlisted: false })]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/select-deep-crawl-topics.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/select-deep-crawl-topics'`

- [ ] **Step 3: Write `src/lib/select-deep-crawl-topics.ts`**

```typescript
import type { CandidateTopic, Category } from '../types';

const CATEGORIES: Category[] = ['tai_chinh', 'giai_tri', 'du_lich'];
const TOP_PER_CATEGORY = 2;
const MAX_TOPICS = 8;

// Unlike rank-and-select.ts's per-category floor (purely additive, no total
// cap), this selection is hard-capped at MAX_TOPICS because the daily deep-
// crawl budget is fixed — floor-then-fill, not additive.
export function selectDeepCrawlTopics(candidates: CandidateTopic[]): string[] {
  const shortlisted = candidates.filter((c) => c.is_shortlisted);

  // Dedup by keyword — the same keyword can appear as multiple rows (one per
  // discovery source: google_trends/youtube/rss). Keep the row with the
  // highest growth_rate as that keyword's representative for ranking.
  const byKeyword = new Map<string, CandidateTopic>();
  for (const c of shortlisted) {
    const existing = byKeyword.get(c.keyword);
    if (!existing || (c.growth_rate ?? 0) > (existing.growth_rate ?? 0)) {
      byKeyword.set(c.keyword, c);
    }
  }
  const deduped = Array.from(byKeyword.values());

  const selected = new Set<string>();

  // Reserve floor: top-2 per category, so every sector still gets some
  // social data even on a day where generic trending crowds it out overall.
  for (const category of CATEGORIES) {
    const inCategory = deduped
      .filter((c) => c.category_hint.includes(category))
      .sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0))
      .slice(0, TOP_PER_CATEGORY);
    for (const c of inCategory) selected.add(c.keyword);
  }

  // Fill remaining slots with the next-highest growth_rate overall,
  // regardless of category — spends the full daily budget instead of
  // leaving slots unused when a category has fewer than 2 good candidates.
  const byGrowthRate = [...deduped].sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0));
  for (const c of byGrowthRate) {
    if (selected.size >= MAX_TOPICS) break;
    selected.add(c.keyword);
  }

  return Array.from(selected).slice(0, MAX_TOPICS);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/select-deep-crawl-topics.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/select-deep-crawl-topics.ts tests/select-deep-crawl-topics.test.ts
git commit -m "feat: add selectDeepCrawlTopics (per-category floor, capped at 8)"
```

---

### Task 4: Apify Threads client

**Files:**
- Create: `src/lib/apify-threads-client.ts`

**Interfaces:**
- Produces: `ThreadsPost` type, `ThreadsSearchClient` interface with `searchByKeyword(keyword: string): Promise<ThreadsPost[]>`, `ApifyThreadsSearchClient` (real implementation).
- Consumes: nothing.

No dedicated test file for this task — it's a thin wrapper around a direct external HTTP call, same convention as `src/lib/youtube-search-client.ts` (`RealYouTubeSearchClient`) and `src/lib/article-extractor.ts`, neither of which has a test file in this codebase. Its behavior is exercised indirectly through Task 5's `deep-crawl.ts` tests via a fake implementing the same `ThreadsSearchClient` interface.

- [ ] **Step 1: Write `src/lib/apify-threads-client.ts`**

```typescript
export interface ThreadsPost {
  post_url: string;
  text_content: string;
  like_count: number | null;
  reply_count: number | null;
  repost_count: number | null;
  quote_count: number | null;
  share_count: number | null;
  view_count: number | null;
  posted_at: string | null;
}

export interface ThreadsSearchClient {
  searchByKeyword(keyword: string): Promise<ThreadsPost[]>;
}

const FETCH_TIMEOUT_MS = 120000;
const MAX_POSTS_PER_TOPIC = 50;
const MAX_TOTAL_CHARGE_USD = 0.5;
const ACTOR_ID = 'futurizerush~meta-threads-scraper';

// Real adapter over Apify's run-sync-get-dataset-items endpoint — blocks
// until the actor run finishes (or times out) and returns dataset items
// directly, so no separate poll loop is needed. maxTotalChargeUsd is a hard
// per-call safety cap (real measured cost ~$0.195/topic at 50 posts, see
// docs/superpowers/specs/2026-08-23-deep-crawl-threads-design.md §6) —
// Apify aborts the run itself if it would exceed this. FETCH_TIMEOUT_MS is
// much longer than this codebase's usual 15s: real runs were measured at
// 1-2+ minutes for 20 posts during the pricing spike that produced this design.
export class ApifyThreadsSearchClient implements ThreadsSearchClient {
  constructor(private apiToken: string) {}

  async searchByKeyword(keyword: string): Promise<ThreadsPost[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${this.apiToken}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode: 'search',
          keywords: [keyword],
          max_posts: MAX_POSTS_PER_TOPIC,
          search_filter: 'top',
          maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD,
        }),
      });
      if (!response.ok) {
        throw new Error(`Apify request failed: ${response.status}`);
      }
      const items = (await response.json()) as Array<Record<string, unknown>>;
      return items
        .filter((item) => item.record_type === 'post' && typeof item.post_url === 'string')
        .map((item) => ({
          post_url: item.post_url as string,
          text_content: (item.text_content as string) ?? '',
          like_count: (item.like_count as number) ?? null,
          reply_count: (item.reply_count as number) ?? null,
          repost_count: (item.repost_count as number) ?? null,
          quote_count: (item.quote_count as number) ?? null,
          share_count: (item.share_count as number) ?? null,
          view_count: (item.view_count as number) ?? null,
          posted_at: (item.created_at as string) ?? null,
        }));
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no test to run for this file — see note above).

- [ ] **Step 3: Commit**

```bash
git add src/lib/apify-threads-client.ts
git commit -m "feat: add Apify Threads search client"
```

---

### Task 5: `deep-crawl.ts` orchestration

**Files:**
- Create: `src/deep-crawl.ts`
- Test: `tests/deep-crawl.test.ts`

**Interfaces:**
- Consumes: `TopicSocialDataRepository`/`FakeTopicSocialDataRepository` (Task 2), `selectDeepCrawlTopics` (Task 3), `ThreadsSearchClient`/`ThreadsPost` (Task 4), `CandidateTopicRepository.getTodayCandidates` (already exists in `src/lib/candidate-topic-repository.ts`), `FakeCandidateTopicRepository` (already exists in `tests/fakes/fake-candidate-topic-repository.ts`).
- Produces: `DeepCrawlDeps`, `DeepCrawlResult`, `runDeepCrawl(deps: DeepCrawlDeps): Promise<DeepCrawlResult>` — used by Task 6's entrypoint.

- [ ] **Step 1: Write the failing tests**

Create `tests/deep-crawl.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runDeepCrawl } from '../src/deep-crawl';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import type { ThreadsSearchClient, ThreadsPost } from '../src/lib/apify-threads-client';
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

function post(overrides: Partial<ThreadsPost> = {}): ThreadsPost {
  return {
    post_url: 'https://threads.net/p/1',
    text_content: 'hello',
    like_count: 1,
    reply_count: 1,
    repost_count: 0,
    quote_count: 0,
    share_count: 0,
    view_count: 100,
    posted_at: '2026-08-23T00:00:00Z',
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

const NOW = () => new Date('2026-08-23T09:00:00Z');

describe('runDeepCrawl', () => {
  it('skips and returns early when topic_social_data already has rows for today', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    await socialRepo.upsertPosts([
      { keyword: 'existing', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/0' },
    ]);
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it('selects topics via selectDeepCrawlTopics and calls the client once per topic', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(
      candidate({ keyword: 'bitcoin', date: '2026-08-23', growth_rate: 10 }),
      candidate({ keyword: 'vang', date: '2026-08-23', growth_rate: 5 })
    );
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.skipped).toBe(false);
    expect(result.topicsSelected).toBe(2);
    expect(client.calls.sort()).toEqual(['bitcoin', 'vang']);
  });

  it('upserts posts returned by the client, tagging them with keyword/source/date', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(candidate({ keyword: 'bitcoin', date: '2026-08-23' }));
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['bitcoin'] = [post({ post_url: 'https://threads.net/p/1' })];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
    expect(socialRepo.posts[0]).toMatchObject({
      keyword: 'bitcoin',
      source: 'threads',
      date: '2026-08-23',
      post_url: 'https://threads.net/p/1',
    });
  });

  it('isolates one topic\'s client failure from the rest', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(
      candidate({ keyword: 'bitcoin', date: '2026-08-23', growth_rate: 10 }),
      candidate({ keyword: 'vang', date: '2026-08-23', growth_rate: 5 })
    );
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();
    client.errorForKeyword['bitcoin'] = 'actor failed';
    client.postsByKeyword['vang'] = [post({ post_url: 'https://threads.net/p/2' })];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors).toEqual(['crawl failed for "bitcoin": actor failed']);
    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
  });

  it('isolates one topic\'s upsert failure from the rest', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(candidate({ keyword: 'bitcoin', date: '2026-08-23' }));
    const socialRepo = new FakeTopicSocialDataRepository();
    socialRepo.upsertError = 'db down';
    const client = new FakeThreadsSearchClient();
    client.postsByKeyword['bitcoin'] = [post()];

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.errors).toEqual(['upsert failed for "bitcoin": db down']);
    expect(result.postsUpserted).toBe(0);
  });

  it('returns 0 topics and makes no client calls when nothing is shortlisted today', async () => {
    const candidateRepo = new FakeCandidateTopicRepository();
    const socialRepo = new FakeTopicSocialDataRepository();
    const client = new FakeThreadsSearchClient();

    const result = await runDeepCrawl({ candidateRepo, socialRepo, client, now: NOW });

    expect(result.topicsSelected).toBe(0);
    expect(client.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/deep-crawl.test.ts`
Expected: FAIL — `Cannot find module '../src/deep-crawl'`

- [ ] **Step 3: Write `src/deep-crawl.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/deep-crawl.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (existing + new), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/deep-crawl.ts tests/deep-crawl.test.ts
git commit -m "feat: add deep-crawl orchestration"
```

---

### Task 6: `run-deep-crawl.ts` entrypoint + `npm run deep-crawl` script

**Files:**
- Create: `src/run-deep-crawl.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runDeepCrawl`/`DeepCrawlDeps` (Task 5), `SupabaseCandidateTopicRepository` (already exists), `SupabaseTopicSocialDataRepository` (Task 2), `ApifyThreadsSearchClient` (Task 4), `getRequiredEnv` (already exists in `src/lib/env.ts`).
- Produces: nothing further consumed by later tasks — this is the CLI entrypoint invoked by the workflow (Task 7).

- [ ] **Step 1: Write `src/run-deep-crawl.ts`**

```typescript
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { ApifyThreadsSearchClient } from './lib/apify-threads-client';
import { runDeepCrawl } from './deep-crawl';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const candidateRepo = new SupabaseCandidateTopicRepository(client);
  const socialRepo = new SupabaseTopicSocialDataRepository(client);
  const apifyClient = new ApifyThreadsSearchClient(getRequiredEnv('APIFY_TOKEN'));

  const result = await runDeepCrawl({ candidateRepo, socialRepo, client: apifyClient });

  if (result.skipped) {
    console.log('Deep-crawl already ran today — skipped.');
    return;
  }

  console.log(`topicsSelected=${result.topicsSelected} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`);
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

- [ ] **Step 2: Add the script to `package.json`**

In the `"scripts"` block, add a line after `"rank": "tsx src/run-rank-and-select.ts"`:

```json
    "deep-crawl": "tsx src/run-deep-crawl.ts"
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/run-deep-crawl.ts package.json
git commit -m "feat: add run-deep-crawl entrypoint and npm script"
```

---

### Task 7: Workflow job + README

**Files:**
- Modify: `.github/workflows/discovery-ingestion.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm run deep-crawl` (Task 6).
- Produces: nothing further — final task, wires everything into CI.

- [ ] **Step 1: Append the `deep-crawl` job to `.github/workflows/discovery-ingestion.yml`**

Add after the `rank-and-select` job:

```yaml
  deep-crawl:
    needs: [discovery-ingest, rank-and-select]
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run deep-crawl
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}
```

- [ ] **Step 2: Update `README.md`**

Add a new section after the existing "## Discovery layer (sub-project 2a)" section (after the line ending "...this sub-project does not call Apify."):

```markdown
## Deep-crawl Threads (sub-project 2b v1)

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export APIFY_TOKEN=...
npm run deep-crawl   # reads today's shortlisted candidate_topics, searches Threads for up to 8 of them -> topic_social_data
```

Setup: apply `supabase/migrations/0004_add_topic_social_data.sql` (after `0001`-`0003`), and add an `APIFY_TOKEN` secret in the GitHub repo (from an Apify account — used for `futurizerush/meta-threads-scraper`, ~$39/month at 8 topics/day x 50 posts/topic, 1x/day; see `docs/superpowers/specs/2026-08-23-deep-crawl-threads-design.md`).

Scoped to Threads only — Facebook and TikTok are deliberately out of scope, see the design spec §7/§8 for why. Runs as a 3rd job in `discovery-ingestion.yml`, guarded by an idempotency check (skips if `topic_social_data` already has rows for today) rather than a hardcoded run time, so it only spends Apify budget once per day regardless of how many times the workflow runs that day.
```

- [ ] **Step 3: Final full verification**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/discovery-ingestion.yml README.md
git commit -m "feat: wire deep-crawl into discovery-ingestion workflow"
```

Note for the human operator (not an automated step): add the `APIFY_TOKEN` secret to the GitHub repo before this job runs for real — until then, `deep-crawl` will fail at `getRequiredEnv('APIFY_TOKEN')` (visible as a red job, isolated from `discovery-ingest`/`rank-and-select` by `if: ${{ !cancelled() }}`, same failure-isolation pattern as every other job chain in this repo).
